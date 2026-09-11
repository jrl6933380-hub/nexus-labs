// lib/roomMetering.js
// Per-account Room build credits with atomic Redis reservations.
// This is usage metering and a hard safety ceiling, not billing: the
// credit unit is intentionally provider-neutral until real provider
// cost attribution is wired in a later slice.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const DEFAULT_CONFIG = Object.freeze({
  periodMs: 30 * 24 * 60 * 60 * 1000,
  creditsLimit: 250,
  assistantCredits: 1,
  freshBuildCredits: 10,
  editCredits: 2,
  reservationTtlSeconds: 15 * 60,
  // Daily pool: a separate, smaller ceiling on top of the 30-day one.
  // Resets every calendar-ish 24h window instead of every 30 days, and
  // is checked first in reserveBuild since it is expected to be the
  // tighter day-to-day limit (e.g. Free/Hosted tier daily usage bar).
  dailyPeriodMs: 24 * 60 * 60 * 1000,
  dailyCreditsLimit: 100,
});

const CLEANUP_SCRIPT = [
  "local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])",
  "for _, reservationKey in ipairs(expired) do",
  "  local amount = tonumber(redis.call('GET', reservationKey) or '0')",
  "  if amount and amount > 0 then redis.call('HINCRBY', KEYS[1], 'reserved', -amount) end",
  "  redis.call('DEL', reservationKey)",
  "  redis.call('ZREM', KEYS[2], reservationKey)",
  "end",
  "return #expired",
].join('\n');

const RESERVE_SCRIPT = [
  "local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[4])",
  "for _, reservationKey in ipairs(expired) do",
  "  local amount = tonumber(redis.call('GET', reservationKey) or '0')",
  "  if amount and amount > 0 then redis.call('HINCRBY', KEYS[1], 'reserved', -amount) end",
  "  redis.call('DEL', reservationKey)",
  "  redis.call('ZREM', KEYS[3], reservationKey)",
  "end",
  "local existing = redis.call('GET', KEYS[2])",
  "if existing then return tonumber(existing) end",
  "local consumed = tonumber(redis.call('HGET', KEYS[1], 'consumed') or '0')",
  "local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')",
  "local requested = tonumber(ARGV[1])",
  "local limit = tonumber(ARGV[2])",
  "if consumed + reserved + requested > limit then return 0 end",
  "redis.call('HSET', KEYS[1], 'limit', limit, 'updatedAt', ARGV[4])",
  "redis.call('HINCRBY', KEYS[1], 'reserved', requested)",
  "redis.call('SET', KEYS[2], tostring(requested), 'EX', ARGV[6])",
  "redis.call('ZADD', KEYS[3], ARGV[5], KEYS[2])",
  "redis.call('EXPIRE', KEYS[1], ARGV[6])",
  "redis.call('EXPIRE', KEYS[3], ARGV[6])",
  "return requested",
].join('\n');

const SETTLE_SCRIPT = [
  "local reserved = tonumber(redis.call('GET', KEYS[2]) or '0')",
  "if not reserved or reserved <= 0 then return 0 end",
  "local charge = tonumber(ARGV[1]) or 0",
  "if charge < 0 then charge = 0 end",
  "if charge > reserved then charge = reserved end",
  "redis.call('HINCRBY', KEYS[1], 'reserved', -reserved)",
  "if charge > 0 then redis.call('HINCRBY', KEYS[1], 'consumed', charge) end",
  "redis.call('HSET', KEYS[1], 'updatedAt', ARGV[2])",
  "redis.call('DEL', KEYS[2])",
  "redis.call('ZREM', KEYS[3], KEYS[2])",
  "return charge",
].join('\n');

function positiveNumber(value, fallback, { integer = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return integer ? Math.floor(number) : number;
}

function userIdSet(value) {
  const values = Array.isArray(value) || value instanceof Set
    ? [...value]
    : String(value || '').split(',');
  return new Set(values.map((item) => String(item).trim()).filter(Boolean));
}

function normalizeConfig(input = {}) {
  return {
    periodMs: positiveNumber(input.periodMs ?? process.env.ROOM_METER_PERIOD_MS, DEFAULT_CONFIG.periodMs),
    creditsLimit: positiveNumber(input.creditsLimit ?? process.env.ROOM_CREDITS_LIMIT, DEFAULT_CONFIG.creditsLimit),
    assistantCredits: positiveNumber(input.assistantCredits ?? process.env.ROOM_ASSISTANT_CREDITS, DEFAULT_CONFIG.assistantCredits),
    freshBuildCredits: positiveNumber(input.freshBuildCredits ?? process.env.ROOM_FRESH_BUILD_CREDITS, DEFAULT_CONFIG.freshBuildCredits),
    editCredits: positiveNumber(input.editCredits ?? process.env.ROOM_EDIT_CREDITS, DEFAULT_CONFIG.editCredits),
    reservationTtlSeconds: positiveNumber(input.reservationTtlSeconds ?? process.env.ROOM_RESERVATION_TTL_SECONDS, DEFAULT_CONFIG.reservationTtlSeconds),
    exemptUserIds: userIdSet(input.exemptUserIds ?? process.env.ROOM_EXEMPT_USER_IDS),
    dailyPeriodMs: positiveNumber(input.dailyPeriodMs ?? process.env.ROOM_DAILY_PERIOD_MS, DEFAULT_CONFIG.dailyPeriodMs),
    dailyCreditsLimit: positiveNumber(input.dailyCreditsLimit ?? process.env.ROOM_DAILY_CREDITS_LIMIT, DEFAULT_CONFIG.dailyCreditsLimit),
  };
}

function encodeKey(value) {
  return encodeURIComponent(String(value));
}

function periodFor(timestamp, periodMs) {
  return Math.floor(Number(timestamp) / periodMs);
}

function resetAt(period, periodMs) {
  return (period + 1) * periodMs;
}

function readNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readEvalResult(result) {
  if (Array.isArray(result)) return readNumber(result[0]);
  return readNumber(result);
}

function newReservationId(now) {
  return String(now()) + '-' + Math.random().toString(36).slice(2, 10);
}

async function defaultRedisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error('roomMetering redis command failed', command[0], response.status);
    throw new Error('Room usage store request failed');
  }
  return data.result;
}

export function createRoomMeter({ command = defaultRedisCommand, now = () => Date.now(), config = {} } = {}) {
  const settings = normalizeConfig(config);

  function isExemptUser(userId) {
    return settings.exemptUserIds.has(String(userId));
  }

  function unlimitedUsage(timestamp) {
    const period = periodFor(timestamp, settings.periodMs);
    return {
      period,
      periodStart: period * settings.periodMs,
      resetAt: null,
      limit: null,
      consumed: 0,
      reserved: 0,
      remaining: null,
      unlimited: true,
      unit: 'room-build-credits',
    };
  }

  function unlimitedDailyUsage(timestamp) {
    const dailyPeriod = periodFor(timestamp, settings.dailyPeriodMs);
    return {
      period: dailyPeriod,
      periodStart: dailyPeriod * settings.dailyPeriodMs,
      resetAt: null,
      limit: null,
      consumed: 0,
      reserved: 0,
      remaining: null,
      percentRemaining: 100,
      unlimited: true,
      unit: 'room-daily-credits',
    };
  }

  function meterKey(userId, period) {
    return 'nexus:room:meter:' + encodeKey(userId) + ':' + period;
  }

  function reservationIndexKey(userId, period) {
    return 'nexus:room:reservation-index:' + encodeKey(userId) + ':' + period;
  }

  function reservationKey(userId, period, reservationId) {
    return 'nexus:room:reservation:' + encodeKey(userId) + ':' + period + ':' + encodeKey(reservationId);
  }

  function dailyMeterKey(userId, period) {
    return 'nexus:room:daily-meter:' + encodeKey(userId) + ':' + period;
  }

  function dailyReservationIndexKey(userId, period) {
    return 'nexus:room:daily-reservation-index:' + encodeKey(userId) + ':' + period;
  }

  function dailyReservationKey(userId, period, reservationId) {
    return 'nexus:room:daily-reservation:' + encodeKey(userId) + ':' + period + ':' + encodeKey(reservationId);
  }

  async function getUsageSummary(userId, { timestamp = now() } = {}) {
    if (!userId) throw new Error('Room usage requires a user id');
    if (isExemptUser(userId)) return unlimitedUsage(timestamp);
    const period = periodFor(timestamp, settings.periodMs);
    const usageKey = meterKey(userId, period);
    const indexKey = reservationIndexKey(userId, period);
    await command(['EVAL', CLEANUP_SCRIPT, '2', usageKey, indexKey, String(timestamp)]);
    const raw = await command([
      'HMGET',
      usageKey,
      'limit',
      'consumed',
      'reserved',
      'updatedAt',
    ]);
    const values = Array.isArray(raw) ? raw : [];
    const limit = readNumber(values[0], settings.creditsLimit);
    const consumed = Math.max(0, readNumber(values[1]));
    const reserved = Math.max(0, readNumber(values[2]));
    return {
      period,
      periodStart: period * settings.periodMs,
      resetAt: resetAt(period, settings.periodMs),
      limit,
      consumed,
      reserved,
      remaining: Math.max(0, limit - consumed - reserved),
      unit: 'room-build-credits',
    };
  }

  async function getDailyUsageSummary(userId, { timestamp = now() } = {}) {
    if (!userId) throw new Error('Room usage requires a user id');
    if (isExemptUser(userId)) return unlimitedDailyUsage(timestamp);
    const dailyPeriod = periodFor(timestamp, settings.dailyPeriodMs);
    const usageKey = dailyMeterKey(userId, dailyPeriod);
    const indexKey = dailyReservationIndexKey(userId, dailyPeriod);
    await command(['EVAL', CLEANUP_SCRIPT, '2', usageKey, indexKey, String(timestamp)]);
    const raw = await command([
      'HMGET',
      usageKey,
      'limit',
      'consumed',
      'reserved',
      'updatedAt',
    ]);
    const values = Array.isArray(raw) ? raw : [];
    const limit = readNumber(values[0], settings.dailyCreditsLimit);
    const consumed = Math.max(0, readNumber(values[1]));
    const reserved = Math.max(0, readNumber(values[2]));
    const remaining = Math.max(0, limit - consumed - reserved);
    return {
      period: dailyPeriod,
      periodStart: dailyPeriod * settings.dailyPeriodMs,
      resetAt: resetAt(dailyPeriod, settings.dailyPeriodMs),
      limit,
      consumed,
      reserved,
      remaining,
      // Convenience for a bar-only UI (per product decision: show a bar,
      // not a raw number). Callers that want the raw remaining value
      // still have it above; the API layer decides what to expose.
      percentRemaining: limit > 0 ? Math.round((remaining / limit) * 100) : 0,
      unit: 'room-daily-credits',
    };
  }

  async function reserveBuild({ userId, kind = 'fresh', requestId } = {}) {
    if (!userId) throw new Error('Room usage requires a user id');
    if (!['assistant', 'fresh', 'edit'].includes(kind)) throw new Error('Unknown Room usage kind');
    const timestamp = now();
    const period = periodFor(timestamp, settings.periodMs);
    if (isExemptUser(userId)) {
      return {
        ok: true,
        kind,
        reservationId: 'exempt',
        period,
        reserved: 0,
        resetAt: null,
        unlimited: true,
        unit: 'room-build-credits',
      };
    }
    const periodReset = resetAt(period, settings.periodMs);
    const units = kind === 'assistant'
      ? settings.assistantCredits
      : kind === 'edit'
        ? settings.editCredits
        : settings.freshBuildCredits;
    const reservationId = requestId ? String(requestId) : newReservationId(now);

    // Daily pool is checked first (it's expected to be the tighter,
    // faster-resetting limit). If it rejects, nothing else has been
    // touched yet, so there is nothing to roll back.
    const dailyPeriod = periodFor(timestamp, settings.dailyPeriodMs);
    const dailyReset = resetAt(dailyPeriod, settings.dailyPeriodMs);
    const dailyReservationExpiry = Math.min(
      dailyReset,
      timestamp + settings.reservationTtlSeconds * 1000,
    );
    const dailyTtlSeconds = Math.max(1, Math.ceil((dailyReset - timestamp) / 1000));
    const dailyResult = await command([
      'EVAL',
      RESERVE_SCRIPT,
      '3',
      dailyMeterKey(userId, dailyPeriod),
      dailyReservationKey(userId, dailyPeriod, reservationId),
      dailyReservationIndexKey(userId, dailyPeriod),
      String(units),
      String(settings.dailyCreditsLimit),
      String(settings.reservationTtlSeconds),
      String(timestamp),
      String(dailyReservationExpiry),
      String(dailyTtlSeconds),
    ]);
    const dailyAcceptedUnits = readEvalResult(dailyResult);
    if (dailyAcceptedUnits <= 0) {
      return {
        ok: false,
        reason: 'daily_budget_exhausted',
        reservationId: null,
        kind,
        daily: await getDailyUsageSummary(userId, { timestamp }),
      };
    }

    const reservationExpiry = Math.min(
      periodReset,
      timestamp + settings.reservationTtlSeconds * 1000,
    );
    const periodTtlSeconds = Math.max(1, Math.ceil((periodReset - timestamp) / 1000));
    const result = await command([
      'EVAL',
      RESERVE_SCRIPT,
      '3',
      meterKey(userId, period),
      reservationKey(userId, period, reservationId),
      reservationIndexKey(userId, period),
      String(units),
      String(settings.creditsLimit),
      String(settings.reservationTtlSeconds),
      String(timestamp),
      String(reservationExpiry),
      String(periodTtlSeconds),
    ]);
    const acceptedUnits = readEvalResult(result);
    if (acceptedUnits <= 0) {
      // Monthly budget rejected the reservation: release the daily hold
      // immediately rather than letting it sit reserved for up to
      // reservationTtlSeconds, which would otherwise wrongly block real
      // usage for the rest of the day.
      await command([
        'EVAL',
        SETTLE_SCRIPT,
        '3',
        dailyMeterKey(userId, dailyPeriod),
        dailyReservationKey(userId, dailyPeriod, reservationId),
        dailyReservationIndexKey(userId, dailyPeriod),
        '0',
        String(now()),
      ]);
      return {
        ok: false,
        reason: 'budget_exhausted',
        reservationId: null,
        kind,
        ...await getUsageSummary(userId, { timestamp }),
      };
    }
    return {
      ok: true,
      kind,
      reservationId,
      period,
      reserved: acceptedUnits,
      resetAt: periodReset,
      unit: 'room-build-credits',
    };
  }

  async function settleBuild({ userId, period, reservationId, success, chargedCredits } = {}) {
    if (userId && isExemptUser(userId)) {
      return { charged: 0, success: Boolean(success), unlimited: true };
    }
    if (!userId || !reservationId || !Number.isFinite(Number(period))) {
      throw new Error('Room usage settlement requires user, period, and reservation');
    }
    const requestedCharge = success ? (chargedCredits == null ? Infinity : Number(chargedCredits)) : 0;
    const charge = Number.isFinite(requestedCharge) ? Math.max(0, requestedCharge) : settings.creditsLimit;
    const settleTimestamp = now();
    const result = await command([
      'EVAL',
      SETTLE_SCRIPT,
      '3',
      meterKey(userId, period),
      reservationKey(userId, period, reservationId),
      reservationIndexKey(userId, period),
      String(charge),
      String(settleTimestamp),
    ]);
    // Best-effort daily settlement: the daily reservation was keyed to the
    // day at reserve time, but we settle by recomputing the day from the
    // current settle-time timestamp rather than threading an extra
    // dailyPeriod parameter through every caller. In the rare case a
    // build straddles a midnight rollover between reserve and settle,
    // this lookup simply finds nothing to settle (the daily SETTLE_SCRIPT
    // call below returns 0) and is silently skipped rather than
    // mis-charging the wrong day's bucket.
    const dailyPeriod = periodFor(settleTimestamp, settings.dailyPeriodMs);
    await command([
      'EVAL',
      SETTLE_SCRIPT,
      '3',
      dailyMeterKey(userId, dailyPeriod),
      dailyReservationKey(userId, dailyPeriod, reservationId),
      dailyReservationIndexKey(userId, dailyPeriod),
      String(charge),
      String(settleTimestamp),
    ]);
    return { charged: readEvalResult(result), success: Boolean(success) };
  }

  return { getUsageSummary, getDailyUsageSummary, reserveBuild, settleBuild, settings };
}

export { CLEANUP_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT };
export const roomMeter = createRoomMeter();
