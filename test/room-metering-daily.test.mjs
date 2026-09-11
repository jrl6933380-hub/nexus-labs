import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomMeter, CLEANUP_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT } from '../lib/roomMetering.js';

// Same fake Redis shape as test/room-metering.test.mjs, duplicated here
// (rather than imported) since it is a private test helper, not an
// exported utility.
function fakeRedis() {
  const hashes = new Map();
  const reservations = new Map();
  const expiry = new Map();

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
    hashes,
    reservations,
  };
}

let clock = 1_700_000_000_000;
const now = () => clock;

test('daily pool blocks a reservation even when monthly budget remains, and does not touch the monthly meter', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10000, dailyCreditsLimit: 15, freshBuildCredits: 10 },
  });
  const first = await meter.reserveBuild({ userId: 'u1', kind: 'fresh' });
  assert.equal(first.ok, true);
  await meter.settleBuild({ userId: 'u1', period: first.period, reservationId: first.reservationId, success: true });

  const dailyAfterOne = await meter.getDailyUsageSummary('u1', { timestamp: clock });
  assert.equal(dailyAfterOne.consumed, 10);
  assert.equal(dailyAfterOne.remaining, 5);

  const second = await meter.reserveBuild({ userId: 'u1', kind: 'fresh' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'daily_budget_exhausted');
  assert.equal(second.daily.remaining, 5);

  const monthly = await meter.getUsageSummary('u1', { timestamp: clock });
  assert.equal(monthly.consumed, 10, 'monthly budget should be untouched by the daily rejection');
});

test('monthly exhaustion rolls back the daily reservation it already made', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 5, dailyCreditsLimit: 1000, freshBuildCredits: 10 },
  });
  const attempt = await meter.reserveBuild({ userId: 'u2', kind: 'fresh' });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'budget_exhausted');

  const daily = await meter.getDailyUsageSummary('u2', { timestamp: clock });
  assert.equal(daily.reserved, 0, 'daily reservation should have been rolled back');
  assert.equal(daily.remaining, 1000);
});

test('daily pool resets after the daily period rolls over', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10000, dailyCreditsLimit: 10, freshBuildCredits: 10 },
  });
  const first = await meter.reserveBuild({ userId: 'u3', kind: 'fresh' });
  assert.equal(first.ok, true);
  await meter.settleBuild({ userId: 'u3', period: first.period, reservationId: first.reservationId, success: true });

  const blocked = await meter.reserveBuild({ userId: 'u3', kind: 'fresh' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'daily_budget_exhausted');

  clock += 24 * 60 * 60 * 1000 + 1000;
  const nextDay = await meter.reserveBuild({ userId: 'u3', kind: 'fresh' });
  assert.equal(nextDay.ok, true, 'a new day should allow a fresh reservation');
});

test('exempt users are unlimited on the daily pool too', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { dailyCreditsLimit: 1, exemptUserIds: ['vip'] },
  });
  const daily = await meter.getDailyUsageSummary('vip', { timestamp: clock });
  assert.equal(daily.unlimited, true);
  const reserved = await meter.reserveBuild({ userId: 'vip', kind: 'fresh' });
  assert.equal(reserved.ok, true);
});

test('an edit reservation only spends editCredits from the daily pool, not a full build', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10000, dailyCreditsLimit: 10, editCredits: 2 },
  });
  const first = await meter.reserveBuild({ userId: 'u4', kind: 'edit' });
  assert.equal(first.ok, true);
  await meter.settleBuild({ userId: 'u4', period: first.period, reservationId: first.reservationId, success: true });
  const daily = await meter.getDailyUsageSummary('u4', { timestamp: clock });
  assert.equal(daily.consumed, 2);
  assert.equal(daily.remaining, 8);
});
