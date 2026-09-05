// lib/tenantMetering.js
// Enforces the credit quota that lib/tenantProvisioning.js already
// attaches to every hosted tenant (BYO tenants have no quota and
// never call this). Reuses the exact same atomic reserve/settle Lua
// scripts as lib/roomMetering.js — those scripts are generic (they
// only touch the Redis keys passed in via KEYS/ARGV, nothing
// room-specific baked in), so this is real reuse, not a fork. Only
// the key naming and the period length are tenant-specific: each
// tenant's period comes from ITS OWN quota.periodDays rather than one
// global env var, since different tenants can have different plans.

import { CLEANUP_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT } from './roomMetering.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const DEFAULT_RESERVATION_TTL_SECONDS = 15 * 60;

function encodeKey(value) {
  return encodeURIComponent(String(value));
}

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
    console.error('tenantMetering redis command failed', command[0], res.status);
    throw new Error('Tenant usage store request failed');
  }
  return data.result;
}

export function createTenantMeter({ command = defaultRedisCommand, now = () => Date.now() } = {}) {
  function meterKey(tenantId, period) {
    return 'nexus:tenant:meter:' + encodeKey(tenantId) + ':' + period;
  }
  function reservationIndexKey(tenantId, period) {
    return 'nexus:tenant:reservation-index:' + encodeKey(tenantId) + ':' + period;
  }
  function reservationKey(tenantId, period, reservationId) {
    return 'nexus:tenant:reservation:' + encodeKey(tenantId) + ':' + period + ':' + encodeKey(reservationId);
  }

  function quotaToMs(quota) {
    const days = readNumber(quota?.periodDays, 30);
    return Math.max(1, days) * 24 * 60 * 60 * 1000;
  }

  async function getUsageSummary({ tenantId, quota, timestamp = now() } = {}) {
    if (!tenantId) throw new Error('Tenant usage requires a tenant id');
    if (!quota) throw new Error('Tenant usage requires the tenant\'s quota (BYO tenants have no managed quota)');
    const periodMs = quotaToMs(quota);
    const period = periodFor(timestamp, periodMs);
    const usageKey = meterKey(tenantId, period);
    const indexKey = reservationIndexKey(tenantId, period);
    await command(['EVAL', CLEANUP_SCRIPT, '2', usageKey, indexKey, String(timestamp)]);
    const raw = await command(['HMGET', usageKey, 'limit', 'consumed', 'reserved', 'updatedAt']);
    const values = Array.isArray(raw) ? raw : [];
    const limit = readNumber(values[0], readNumber(quota.creditsPerPeriod, 0));
    const consumed = Math.max(0, readNumber(values[1]));
    const reserved = Math.max(0, readNumber(values[2]));
    return {
      period,
      periodStart: period * periodMs,
      resetAt: resetAt(period, periodMs),
      limit,
      consumed,
      reserved,
      remaining: Math.max(0, limit - consumed - reserved),
      unit: 'tenant-credits',
    };
  }

  async function reserveCredits({ tenantId, quota, amount, requestId, reservationTtlSeconds = DEFAULT_RESERVATION_TTL_SECONDS } = {}) {
    if (!tenantId) throw new Error('Tenant usage requires a tenant id');
    if (!quota) throw new Error('Tenant usage requires the tenant\'s quota');
    const units = readNumber(amount, 0);
    if (units <= 0) throw new Error('amount must be a positive number of credits');

    const timestamp = now();
    const periodMs = quotaToMs(quota);
    const period = periodFor(timestamp, periodMs);
    const periodReset = resetAt(period, periodMs);
    const limit = readNumber(quota.creditsPerPeriod, 0);
    const reservationId = requestId ? String(requestId) : newReservationId(now);
    const reservationExpiry = Math.min(periodReset, timestamp + reservationTtlSeconds * 1000);
    const periodTtlSeconds = Math.max(1, Math.ceil((periodReset - timestamp) / 1000));

    const result = await command([
      'EVAL',
      RESERVE_SCRIPT,
      '3',
      meterKey(tenantId, period),
      reservationKey(tenantId, period, reservationId),
      reservationIndexKey(tenantId, period),
      String(units),
      String(limit),
      String(reservationTtlSeconds),
      String(timestamp),
      String(reservationExpiry),
      String(periodTtlSeconds),
    ]);
    const accepted = readEvalResult(result);
    if (accepted <= 0) {
      return { ok: false, reason: 'budget_exhausted', reservationId: null, ...await getUsageSummary({ tenantId, quota, timestamp }) };
    }
    return { ok: true, reservationId, period, reserved: accepted, resetAt: periodReset, unit: 'tenant-credits' };
  }

  async function settleCredits({ tenantId, period, reservationId, success, chargedCredits, quota } = {}) {
    if (!tenantId || !reservationId || !Number.isFinite(Number(period))) {
      throw new Error('Tenant usage settlement requires tenant, period, and reservation');
    }
    const limit = readNumber(quota?.creditsPerPeriod, Infinity);
    const requestedCharge = success ? (chargedCredits == null ? Infinity : Number(chargedCredits)) : 0;
    const charge = Number.isFinite(requestedCharge) ? Math.max(0, requestedCharge) : limit;
    const result = await command([
      'EVAL',
      SETTLE_SCRIPT,
      '3',
      meterKey(tenantId, period),
      reservationKey(tenantId, period, reservationId),
      reservationIndexKey(tenantId, period),
      String(charge),
      String(now()),
    ]);
    return { charged: readEvalResult(result), success: Boolean(success) };
  }

  return { getUsageSummary, reserveCredits, settleCredits };
}

export const tenantMeter = createTenantMeter();
