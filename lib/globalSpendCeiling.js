// lib/globalSpendCeiling.js
// A single hard cap across every tenant combined — the safety net
// sitting above lib/tenantMetering.js's per-tenant quotas. One noisy
// or compromised tenant should never be able to run the whole
// account's real-world spend past what Justin is willing to eat in a
// period, even if every individual tenant is still under its own
// quota.
//
// Deliberately reuses the exact same atomic reserve/settle/cleanup
// Lua scripts already shared between lib/roomMetering.js and
// lib/tenantMetering.js — those scripts are generic (they only touch
// whatever Redis keys are passed in via KEYS/ARGV, nothing tenant- or
// room-specific baked in), so this is real reuse, not a fork. The
// only thing that changes here is scope: ONE meter key for the whole
// account/period instead of one per tenant.
//
// Same injectable-store shape as lib/tenantMetering.js, so this is
// unit-testable with a fake in-memory command() the same way that
// module's tests already work — no live Redis required.

import { CLEANUP_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT } from './roomMetering.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const DEFAULT_RESERVATION_TTL_SECONDS = 15 * 60;
const GLOBAL_METER_KEY = 'nexus:global:ceiling';
const GLOBAL_RESERVATION_INDEX_KEY = 'nexus:global:ceiling:reservation-index';

function readNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readEvalResult(result) {
  return Array.isArray(result) ? readNumber(result[0]) : readNumber(result);
}

function periodFor(timestamp, periodMs) {
  return Math.floor(Number(timestamp) / periodMs);
}

function resetAt(period, periodMs) {
  return (period + 1) * periodMs;
}

function newReservationId(now) {
  return String(now()) + '-' + Math.random().toString(36).slice(2, 10);
}

async function defaultRedisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('globalSpendCeiling redis command failed', command[0], res.status);
    throw new Error('Global spend ceiling store request failed');
  }
  return data.result;
}

export function createGlobalCeiling({
  command = defaultRedisCommand,
  now = () => Date.now(),
  limit = readNumber(process.env.GLOBAL_SPEND_CEILING_CREDITS, 100000),
  periodDays = readNumber(process.env.GLOBAL_CEILING_PERIOD_DAYS, 30),
} = {}) {
  const periodMs = Math.max(1, periodDays) * 24 * 60 * 60 * 1000;

  function reservationKey(period, reservationId) {
    return GLOBAL_METER_KEY + ':reservation:' + period + ':' + encodeURIComponent(reservationId);
  }
  function meterKey(period) {
    return GLOBAL_METER_KEY + ':' + period;
  }
  function indexKey(period) {
    return GLOBAL_RESERVATION_INDEX_KEY + ':' + period;
  }

  async function getGlobalUsage({ timestamp = now() } = {}) {
    const period = periodFor(timestamp, periodMs);
    const usageKey = meterKey(period);
    const idxKey = indexKey(period);
    await command(['EVAL', CLEANUP_SCRIPT, '2', usageKey, idxKey, String(timestamp)]);
    const raw = await command(['HMGET', usageKey, 'limit', 'consumed', 'reserved', 'updatedAt']);
    const values = Array.isArray(raw) ? raw : [];
    const effectiveLimit = readNumber(values[0], limit);
    const consumed = Math.max(0, readNumber(values[1]));
    const reserved = Math.max(0, readNumber(values[2]));
    return {
      period,
      periodStart: period * periodMs,
      resetAt: resetAt(period, periodMs),
      limit: effectiveLimit,
      consumed,
      reserved,
      remaining: Math.max(0, effectiveLimit - consumed - reserved),
      unit: 'global-credits',
    };
  }

  async function reserveGlobal({ amount, requestId, reservationTtlSeconds = DEFAULT_RESERVATION_TTL_SECONDS } = {}) {
    const units = readNumber(amount, 0);
    if (units <= 0) throw new Error('amount must be a positive number of credits');

    const timestamp = now();
    const period = periodFor(timestamp, periodMs);
    const periodReset = resetAt(period, periodMs);
    const reservationId = requestId ? String(requestId) : newReservationId(now);
    const reservationExpiry = Math.min(periodReset, timestamp + reservationTtlSeconds * 1000);
    const periodTtlSeconds = Math.max(1, Math.ceil((periodReset - timestamp) / 1000));

    const result = await command([
      'EVAL',
      RESERVE_SCRIPT,
      '3',
      meterKey(period),
      reservationKey(period, reservationId),
      indexKey(period),
      String(units),
      String(limit),
      String(reservationTtlSeconds),
      String(timestamp),
      String(reservationExpiry),
      String(periodTtlSeconds),
    ]);
    const accepted = readEvalResult(result);
    if (accepted <= 0) {
      return { ok: false, reason: 'global_ceiling_exhausted', reservationId: null, ...await getGlobalUsage({ timestamp }) };
    }
    return { ok: true, reservationId, period, reserved: accepted, resetAt: periodReset, unit: 'global-credits' };
  }

  async function settleGlobal({ period, reservationId, success, chargedCredits } = {}) {
    if (!reservationId || !Number.isFinite(Number(period))) {
      throw new Error('Global spend ceiling settlement requires period and reservation');
    }
    const requestedCharge = success ? (chargedCredits == null ? Infinity : Number(chargedCredits)) : 0;
    const charge = Number.isFinite(requestedCharge) ? Math.max(0, requestedCharge) : limit;
    const result = await command([
      'EVAL',
      SETTLE_SCRIPT,
      '3',
      meterKey(period),
      reservationKey(period, reservationId),
      indexKey(period),
      String(charge),
      String(now()),
    ]);
    return { charged: readEvalResult(result), success: Boolean(success) };
  }

  return { getGlobalUsage, reserveGlobal, settleGlobal };
}

export const globalCeiling = createGlobalCeiling();
