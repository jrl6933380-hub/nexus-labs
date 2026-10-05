import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTenantMeter } from '../lib/tenantMetering.js';

// A tiny in-memory Redis stand-in that understands only the commands
// tenantMetering.js actually issues (HMGET, EVAL of the three shared
// Lua scripts, plus the housekeeping GET/SET/DEL/ZADD/ZREM/HSET/HINCRBY
// they call internally is simulated by hand, not by running real Lua).
function createFakeStore() {
  const hashes = new Map();
  const strings = new Map();
  const sortedSets = new Map();

  function hget(key, field) {
    return hashes.get(key)?.get(field) ?? null;
  }

  return {
    async command(cmd) {
      const [op] = cmd;
      if (op === 'HMGET') {
        const [, key, ...fields] = cmd;
        return fields.map((f) => hget(key, f));
      }
      if (op === 'EVAL') {
        const [, script] = cmd;
        // Identify which shared script this is by a distinctive substring,
        // then hand-simulate its effect using the same key layout the
        // caller passed (KEYS come immediately after numkeys in cmd).
        const numKeys = Number(cmd[2]);
        const keys = cmd.slice(3, 3 + numKeys);
        const argv = cmd.slice(3 + numKeys);

        if (script.includes('return requested')) {
          // RESERVE_SCRIPT
          const [meterKey, resKey, idxKey] = keys;
          const [amountStr, limitStr] = argv;
          const amount = Number(amountStr);
          const limit = Number(limitStr);
          const h = hashes.get(meterKey) || new Map();
          const consumed = Number(h.get('consumed') || 0);
          const reserved = Number(h.get('reserved') || 0);
          if (consumed + reserved + amount > limit) return 0;
          h.set('reserved', String(reserved + amount));
          hashes.set(meterKey, h);
          strings.set(resKey, String(amount));
          return amount;
        }
        if (script.includes('return charge')) {
          // SETTLE_SCRIPT
          const [meterKey, resKey] = keys;
          const [chargeStr] = argv;
          const reservedAmount = Number(strings.get(resKey) || 0);
          if (!reservedAmount) return 0;
          let charge = Number(chargeStr) || 0;
          if (charge > reservedAmount) charge = reservedAmount;
          const h = hashes.get(meterKey) || new Map();
          h.set('reserved', String(Number(h.get('reserved') || 0) - reservedAmount));
          if (charge > 0) h.set('consumed', String(Number(h.get('consumed') || 0) + charge));
          hashes.set(meterKey, h);
          strings.delete(resKey);
          return charge;
        }
        // CLEANUP_SCRIPT — no expired reservations in these fast unit tests
        return 0;
      }
      throw new Error('Unsupported command in fake store: ' + op);
    },
  };
}

const quota = { creditsPerPeriod: 10, periodDays: 30 };

test('reserveCredits accepts a request within quota', async () => {
  const store = createFakeStore();
  const meter = createTenantMeter({ command: store.command, now: () => 1000 });
  const result = await meter.reserveCredits({ tenantId: 't1', quota, amount: 4, requestId: 'r1' });
  assert.equal(result.ok, true);
  assert.equal(result.reserved, 4);
});

test('reserveCredits rejects a request that exceeds quota', async () => {
  const store = createFakeStore();
  const meter = createTenantMeter({ command: store.command, now: () => 1000 });
  await meter.reserveCredits({ tenantId: 't1', quota, amount: 8, requestId: 'r1' });
  const second = await meter.reserveCredits({ tenantId: 't1', quota, amount: 5, requestId: 'r2' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'budget_exhausted');
});

test('settleCredits charges the reservation and frees the rest', async () => {
  const store = createFakeStore();
  const meter = createTenantMeter({ command: store.command, now: () => 1000 });
  const reservation = await meter.reserveCredits({ tenantId: 't1', quota, amount: 6, requestId: 'r1' });
  const settled = await meter.settleCredits({
    tenantId: 't1',
    period: reservation.period,
    reservationId: 'r1',
    success: true,
    chargedCredits: 3,
    quota,
  });
  assert.equal(settled.charged, 3);
});

test('settleCredits with success false charges nothing', async () => {
  const store = createFakeStore();
  const meter = createTenantMeter({ command: store.command, now: () => 1000 });
  const reservation = await meter.reserveCredits({ tenantId: 't1', quota, amount: 6, requestId: 'r1' });
  const settled = await meter.settleCredits({
    tenantId: 't1',
    period: reservation.period,
    reservationId: 'r1',
    success: false,
    quota,
  });
  assert.equal(settled.charged, 0);
});

test('reserveCredits throws without a quota (BYO tenants have none)', async () => {
  const store = createFakeStore();
  const meter = createTenantMeter({ command: store.command, now: () => 1000 });
  await assert.rejects(() => meter.reserveCredits({ tenantId: 't1', quota: null, amount: 1 }));
});

test('reserveCredits rejects a non-positive amount', async () => {
  const store = createFakeStore();
  const meter = createTenantMeter({ command: store.command, now: () => 1000 });
  await assert.rejects(() => meter.reserveCredits({ tenantId: 't1', quota, amount: 0 }));
});
