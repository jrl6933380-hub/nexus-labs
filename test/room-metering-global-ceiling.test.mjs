import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomMeter } from '../lib/roomMetering.js';
import { fakeRedis } from './helpers/fake-redis.mjs';

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
