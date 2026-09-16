import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomMeter } from '../lib/roomMetering.js';
import { fakeRedis } from './helpers/fake-redis.mjs';
import { createUsageHandler } from '../api/room-usage.js';

let clock = 1_700_000_000_000;
const now = () => clock;

test('fresh and edit reservations use separate credit costs', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 25, freshBuildCredits: 15, editCredits: 2 },
  });
  const fresh = await meter.reserveBuild({ userId: 'alice', kind: 'fresh', requestId: 'fresh-1' });
  const edit = await meter.reserveBuild({ userId: 'alice', kind: 'edit', requestId: 'edit-1' });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.reserved, 15);
  assert.equal(edit.ok, true);
  assert.equal(edit.reserved, 2);
  const summary = await meter.getUsageSummary('alice');
  assert.deepEqual(
    { consumed: summary.consumed, reserved: summary.reserved, remaining: summary.remaining },
    { consumed: 0, reserved: 17, remaining: 8 },
  );
});

test('professional Nex conversation uses a lightweight assistant credit', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 20, assistantCredits: 1, freshBuildCredits: 10, editCredits: 2 },
  });
  const turn = await meter.reserveBuild({ userId: 'alice', kind: 'assistant', requestId: 'talk-1' });
  assert.equal(turn.ok, true);
  assert.equal(turn.reserved, 1);
  await meter.settleBuild({
    userId: 'alice',
    period: turn.period,
    reservationId: turn.reservationId,
    success: true,
  });
  const summary = await meter.getUsageSummary('alice');
  assert.equal(summary.consumed, 1);
  assert.equal(summary.remaining, 19);
});

test('configured owner is exempt while every other account keeps the hard ceiling', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10, freshBuildCredits: 10, exemptUserIds: ['owner'] },
  });

  for (let index = 0; index < 3; index += 1) {
    const reservation = await meter.reserveBuild({ userId: 'owner', requestId: `owner-${index}` });
    assert.equal(reservation.ok, true);
    assert.equal(reservation.unlimited, true);
    assert.equal(reservation.reserved, 0);
    const settlement = await meter.settleBuild({
      userId: 'owner',
      period: reservation.period,
      reservationId: reservation.reservationId,
      success: true,
    });
    assert.equal(settlement.charged, 0);
  }

  const ownerUsage = await meter.getUsageSummary('owner');
  assert.equal(ownerUsage.unlimited, true);
  assert.equal(ownerUsage.limit, null);
  assert.equal(redis.hashes.size, 0);

  const firstCustomer = await meter.reserveBuild({ userId: 'alice', requestId: 'customer-1' });
  const secondCustomer = await meter.reserveBuild({ userId: 'alice', requestId: 'customer-2' });
  assert.equal(firstCustomer.ok, true);
  assert.equal(secondCustomer.ok, false);
  assert.equal(secondCustomer.remaining, 0);
});

test('owner exemption is an exact username match', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10, freshBuildCredits: 10, exemptUserIds: 'owner' },
  });
  await meter.reserveBuild({ userId: 'owner', requestId: 'owner-1' });
  await meter.reserveBuild({ userId: 'Owner', requestId: 'customer-1' });
  const rejected = await meter.reserveBuild({ userId: 'Owner', requestId: 'customer-2' });
  assert.equal(rejected.ok, false);
});

test('hard ceiling rejects a reservation that would exceed the account limit', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 10, freshBuildCredits: 10 } });
  const first = await meter.reserveBuild({ userId: 'alice', requestId: 'one' });
  const second = await meter.reserveBuild({ userId: 'alice', requestId: 'two' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.remaining, 0);
});

test('settlement consumes credits only after a successful build', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 20, freshBuildCredits: 10 } });
  const reservation = await meter.reserveBuild({ userId: 'alice', requestId: 'run-1' });
  await meter.settleBuild({
    userId: 'alice',
    period: reservation.period,
    reservationId: reservation.reservationId,
    success: true,
  });
  const summary = await meter.getUsageSummary('alice');
  assert.equal(summary.consumed, 10);
  assert.equal(summary.reserved, 0);
  assert.equal(summary.remaining, 10);
});

test('failed builds release the reservation without consuming credits', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 20, freshBuildCredits: 10 } });
  const reservation = await meter.reserveBuild({ userId: 'alice', requestId: 'run-1' });
  await meter.settleBuild({
    userId: 'alice',
    period: reservation.period,
    reservationId: reservation.reservationId,
    success: false,
  });
  const summary = await meter.getUsageSummary('alice');
  assert.deepEqual(
    { consumed: summary.consumed, reserved: summary.reserved, remaining: summary.remaining },
    { consumed: 0, reserved: 0, remaining: 20 },
  );
});

test('same request id does not reserve twice while the first attempt is active', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 20, freshBuildCredits: 10 } });
  const first = await meter.reserveBuild({ userId: 'alice', requestId: 'same' });
  const second = await meter.reserveBuild({ userId: 'alice', requestId: 'same' });
  const summary = await meter.getUsageSummary('alice');
  assert.equal(first.reservationId, 'same');
  assert.equal(second.reservationId, 'same');
  assert.equal(summary.reserved, 10);
});

test('expired reservations are reclaimed before the account is evaluated again', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 10, freshBuildCredits: 10, reservationTtlSeconds: 10 },
  });
  const first = await meter.reserveBuild({ userId: 'alice', requestId: 'stale' });
  clock += 10_000;
  const summary = await meter.getUsageSummary('alice');
  assert.equal(summary.reserved, 0);
  assert.equal(summary.remaining, 10);
  assert.equal(first.ok, true);
  const second = await meter.reserveBuild({ userId: 'alice', requestId: 'new' });
  assert.equal(second.ok, true);
});

function response() {
  return {
    code: 0,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('usage endpoint reports the signed-in account and stays read-only', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 20 } });
  const handler = createUsageHandler({ resolveUser: async () => 'alice', meter });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.usage.limit, 20);
});

test('usage endpoint falls back to an anonymous session for signed-out guests', async () => {
  // Guest access to the Room Builder is deliberate (see the guest-access
  // work in api/room-usage.js: no session falls back to getOrCreateAnonId).
  // This endpoint is read-only and returns no account-identifying data, so a
  // guest gets their own anon-scoped meter rather than a 401. An earlier
  // version of this test asserted 401 here; it predated guest access.
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 20 } });
  const guest = response();
  const req = { method: 'GET', headers: {} };
  await createUsageHandler({ resolveUser: async () => null, meter })(req, guest);
  assert.equal(guest.code, 200);
  assert.equal(guest.body.usage.limit, 20);
});

test('usage endpoint rejects any method other than GET', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 20 } });
  const res = response();
  await createUsageHandler({ resolveUser: async () => 'alice', meter })({ method: 'POST' }, res);
  assert.equal(res.code, 405);
});
