import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomMeter, CLEANUP_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT, GLOBAL_SPEND_SCRIPT } from '../lib/roomMetering.js';

function fakeRedis() {
  const hashes = new Map();
  const reservations = new Map();
  const expiry = new Map();
  const counters = new Map();

  function hashFor(key) {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  }

  function cleanup(usageKey, indexKey, timestamp) {
    const entries = expiry.get(indexKey) || new Map();
    for (const [reservationKey, expiresAt] of [...entries]) {
      if (expiresAt > timestamp) continue;
      const amount = Number(reservations.get(reservationKey) || 0);
      if (amount) {
        const hash = hashFor(usageKey);
        hash.set('reserved', Number(hash.get('reserved') || 0) - amount);
      }
      reservations.delete(reservationKey);
      entries.delete(reservationKey);
    }
    expiry.set(indexKey, entries);
  }

  return {
    async command(command) {
      if (command[0] === 'EVAL' && command[1] === GLOBAL_SPEND_SCRIPT) {
        const key = command[3];
        const total = (counters.get(key) || 0) + Number(command[4]);
        counters.set(key, total);
        return total;
      }
      if (command[0] === 'EVAL' && command[1] === CLEANUP_SCRIPT) {
        cleanup(command[3], command[4], Number(command[5]));
        return 0;
      }
      if (command[0] === 'EVAL' && command[1] === RESERVE_SCRIPT) {
        const usageKey = command[3];
        const reservationKey = command[4];
        const indexKey = command[5];
        const requested = Number(command[6]);
        const limit = Number(command[7]);
        const timestamp = Number(command[9]);
        cleanup(usageKey, indexKey, timestamp);
        if (reservations.has(reservationKey)) return reservations.get(reservationKey);
        const hash = hashFor(usageKey);
        const consumed = Number(hash.get('consumed') || 0);
        const reserved = Number(hash.get('reserved') || 0);
        if (consumed + reserved + requested > limit) return 0;
        hash.set('limit', limit);
        hash.set('updatedAt', timestamp);
        hash.set('reserved', reserved + requested);
        reservations.set(reservationKey, requested);
        const entries = expiry.get(indexKey) || new Map();
        entries.set(reservationKey, Number(command[10]));
        expiry.set(indexKey, entries);
        return requested;
      }
      if (command[0] === 'EVAL' && command[1] === SETTLE_SCRIPT) {
        const usageKey = command[3];
        const reservationKey = command[4];
        const indexKey = command[5];
        const reserved = Number(reservations.get(reservationKey) || 0);
        if (!reserved) return 0;
        const hash = hashFor(usageKey);
        const charge = Math.min(reserved, Math.max(0, Number(command[6])));
        hash.set('reserved', Number(hash.get('reserved') || 0) - reserved);
        hash.set('consumed', Number(hash.get('consumed') || 0) + charge);
        hash.set('updatedAt', Number(command[7]));
        reservations.delete(reservationKey);
        (expiry.get(indexKey) || new Map()).delete(reservationKey);
        return charge;
      }
      if (command[0] === 'HMGET') {
        const hash = hashes.get(command[1]);
        return ['limit', 'consumed', 'reserved', 'updatedAt'].map((field) => hash?.get(field) ?? null);
      }
      throw new Error('Unexpected fake Redis command: ' + command[0]);
    },
    counters,
  };
}

let clock = 1_700_000_000_000;
const now = () => clock;

test('free-tier requests are blocked once the global daily ceiling is exceeded', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10000, dailyCreditsLimit: 10000, globalDailyCreditCeiling: 15, freshBuildCredits: 10 },
  });
  const first = await meter.reserveBuild({ userId: 'u1', kind: 'fresh', isFreeTier: true });
  assert.equal(first.ok, true, 'first request (10 units) is under the ceiling of 15');
  const second = await meter.reserveBuild({ userId: 'u2', kind: 'fresh', isFreeTier: true });
  assert.equal(second.ok, false, 'second request would push total to 20, over the ceiling of 15');
  assert.equal(second.reason, 'global_ceiling_exceeded');
});

test('paid-tier requests are never blocked by the global ceiling, even once it is exceeded', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10000, dailyCreditsLimit: 10000, globalDailyCreditCeiling: 5, freshBuildCredits: 10 },
  });
  const paid = await meter.reserveBuild({ userId: 'paid-user', kind: 'fresh', isFreeTier: false });
  assert.equal(paid.ok, true, 'paid tier is protected from the global ceiling entirely');
});

test('the global counter tracks combined spend across both free and paid requests', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10000, dailyCreditsLimit: 10000, globalDailyCreditCeiling: 10000, freshBuildCredits: 10 },
  });
  await meter.reserveBuild({ userId: 'free-user', kind: 'fresh', isFreeTier: true });
  await meter.reserveBuild({ userId: 'paid-user', kind: 'fresh', isFreeTier: false });
  const result = await meter.recordGlobalSpend(0, { timestamp: clock });
  assert.equal(result.total, 20, 'both requests counted toward the same global total');
});

test('the global ceiling resets on the next day, same as the per-user daily pool', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10000, dailyCreditsLimit: 10000, globalDailyCreditCeiling: 10, freshBuildCredits: 10 },
  });
  const first = await meter.reserveBuild({ userId: 'u1', kind: 'fresh', isFreeTier: true });
  assert.equal(first.ok, true);
  const blocked = await meter.reserveBuild({ userId: 'u2', kind: 'fresh', isFreeTier: true });
  assert.equal(blocked.ok, false);
  clock += 24 * 60 * 60 * 1000 + 1000;
  const nextDay = await meter.reserveBuild({ userId: 'u3', kind: 'fresh', isFreeTier: true });
  assert.equal(nextDay.ok, true, 'a new day resets the global counter along with the daily pool');
});
