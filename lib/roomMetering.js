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
  freshBuildCredits: 10,
  editCredits: 2,
  reservationTtlSeconds: 15 * 60,
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

function normalizeConfig(input = {}) {
  return {
    periodMs: positiveNumber(input.periodMs ?? process.env.ROOM_METER_PERIOD_MS, DEFAULT_CONFIG.periodMs),
    creditsLimit: positiveNumber(input.creditsLimit ?? process.env.ROOM_CREDITS_LIMIT, DEFAULT_CONFIG.creditsLimit),
    freshBuildCredits: positiveNumber(input.freshBuildCredits ?? process.env.ROOM_FRESH_BUILD_CREDITS, DEFAULT_CONFIG.freshBuildCredits),
    editCredits: positiveNumber(input.editCredits ?? process.env.ROOM_EDIT_CREDITS, DEFAULT_CONFIG.editCredits),
    reservationTtlSeconds: positiveNumber(input.reservationTtlSeconds ?? process.env.ROOM_RESERVATION_TTL_SECONDS, DEFAULT_CONFIG.reservationTtlSeconds),
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

  function meterKey(userId, period) {
    return 'nexus:room:meter:' + encodeKey(userId) + ':' + period;
  }

  function reservationIndexKey(userId, period) {
    return 'nexus:room:reservation-index:' + encodeKey(userId) + ':' + period;
  }

  function reservationKey(userId, period, reservationId) {
    return 'nexus:room:reservation:' + encodeKey(userId) + ':' + period + ':' + encodeKey(reservationId);
  }

  async function getUsageSummary(userId, { timestamp = now() } = {}) {
    if (!userId) throw new Error('Room usage requires a user id');
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

  async function reserveBuild({ userId, kind = 'fresh', requestId } = {}) {
    if (!userId) throw new Error('Room usage requires a user id');
    if (kind !== 'fresh' && kind !== 'edit') throw new Error('Unknown Room usage kind');
    const timestamp = now();
    const period = periodFor(timestamp, settings.periodMs);
    const periodReset = resetAt(period, settings.periodMs);
    const units = kind === 'edit' ? settings.editCredits : settings.freshBuildCredits;
    const reservationId = requestId ? String(requestId) : newReservationId(now);
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
    if (!userId || !reservationId || !Number.isFinite(Number(period))) {
      throw new Error('Room usage settlement requires user, period, and reservation');
    }
    const requestedCharge = success ? (chargedCredits == null ? Infinity : Number(chargedCredits)) : 0;
    const charge = Number.isFinite(requestedCharge) ? Math.max(0, requestedCharge) : settings.creditsLimit;
    const result = await command([
      'EVAL',
      SETTLE_SCRIPT,
      '3',
      meterKey(userId, period),
      reservationKey(userId, period, reservationId),
      reservationIndexKey(userId, period),
      String(charge),
      String(now()),
    ]);
    return { charged: readEvalResult(result), success: Boolean(success) };
  }

  return { getUsageSummary, reserveBuild, settleBuild, settings };
}

export { CLEANUP_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT };
export const roomMeter = createRoomMeter();
