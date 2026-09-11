import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalCeiling } from '../lib/globalSpendCeiling.js';

// Same fake-Redis approach as test/tenant-metering.test.mjs: a tiny
// in-memory stand-in that only understands the exact commands
// lib/globalSpendCeiling.js issues (HMGET, EVAL of the three shared
// Lua scripts), with the scripts' effects hand-simulated rather than
// run for real.
function createFakeStore() {
  const hashes = new Map();
  const strings = new Map();

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
        const numKeys = Number(cmd[2]);
        const keys = cmd.slice(3, 3 + numKeys);
        const argv = cmd.slice(3 + numKeys);

        if (script.includes('return requested')) {
          // RESERVE_SCRIPT
          const [meterKey, resKey] = keys;
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

test('reserveGlobal accepts a request within the global ceiling', async () => {
  const store = createFakeStore();
  const ceiling = createGlobalCeiling({ command: store.command, now: () => 1000, limit: 10, periodDays: 30 });
  const result = await ceiling.reserveGlobal({ amount: 4, requestId: 'r1' });
  assert.equal(result.ok, true);
  assert.equal(result.reserved, 4);
});

test('reserveGlobal rejects a request that would exceed the global ceiling', async () => {
  const store = createFakeStore();
  const ceiling = createGlobalCeiling({ command: store.command, now: () => 1000, limit: 10, periodDays: 30 });
  await ceiling.reserveGlobal({ amount: 8, requestId: 'r1' });
  const second = await ceiling.reserveGlobal({ amount: 5, requestId: 'r2' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'global_ceiling_exhausted');
});

test('reserveGlobal enforces the cap across DIFFERENT tenants (global, not per-tenant)', async () => {
  const store = createFakeStore();
  const ceiling = createGlobalCeiling({ command: store.command, now: () => 1000, limit: 10, periodDays: 30 });
  // Two unrelated "tenants" both reserving against the same global pool —
  // there is no tenant id in this API at all, which is the point: the
  // ceiling is a single shared pool no per-tenant quota can bypass.
  const first = await ceiling.reserveGlobal({ amount: 6, requestId: 'tenant-a-r1' });
  const second = await ceiling.reserveGlobal({ amount: 6, requestId: 'tenant-b-r1' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
});

test('settleGlobal charges the reservation and frees the rest', async () => {
  const store = createFakeStore();
  const ceiling = createGlobalCeiling({ command: store.command, now: () => 1000, limit: 10, periodDays: 30 });
  const reservation = await ceiling.reserveGlobal({ amount: 6, requestId: 'r1' });
  const settled = await ceiling.settleGlobal({ period: reservation.period, reservationId: 'r1', success: true, chargedCredits: 3 });
  assert.equal(settled.charged, 3);

  const usage = await ceiling.getGlobalUsage({ timestamp: 1000 });
  assert.equal(usage.consumed, 3);
  assert.equal(usage.reserved, 0);
  assert.equal(usage.remaining, 7);
});

test('settleGlobal with success false charges nothing and frees the reservation', async () => {
  const store = createFakeStore();
  const ceiling = createGlobalCeiling({ command: store.command, now: () => 1000, limit: 10, periodDays: 30 });
  const reservation = await ceiling.reserveGlobal({ amount: 6, requestId: 'r1' });
  const settled = await ceiling.settleGlobal({ period: reservation.period, reservationId: 'r1', success: false });
  assert.equal(settled.charged, 0);

  const usage = await ceiling.getGlobalUsage({ timestamp: 1000 });
  assert.equal(usage.consumed, 0);
  assert.equal(usage.reserved, 0);
  assert.equal(usage.remaining, 10);
});

test('reserveGlobal rejects a non-positive amount', async () => {
  const store = createFakeStore();
  const ceiling = createGlobalCeiling({ command: store.command, now: () => 1000, limit: 10, periodDays: 30 });
  await assert.rejects(() => ceiling.reserveGlobal({ amount: 0, requestId: 'r1' }));
});
