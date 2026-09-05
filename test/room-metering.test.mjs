import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomMeter, CLEANUP_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT } from '../lib/roomMetering.js';
import { createUsageHandler } from '../api/room-usage.js';

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

test('fresh and edit reservations use separate credit costs', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({
    command: redis.command,
    now,
    config: { creditsLimit: 20, freshBuildCredits: 10, editCredits: 2 },
  });
  const fresh = await meter.reserveBuild({ userId: 'alice', kind: 'fresh', requestId: 'fresh-1' });
  const edit = await meter.reserveBuild({ userId: 'alice', kind: 'edit', requestId: 'edit-1' });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.reserved, 10);
  assert.equal(edit.ok, true);
  assert.equal(edit.reserved, 2);
  const summary = await meter.getUsageSummary('alice');
  assert.deepEqual(
    { consumed: summary.consumed, reserved: summary.reserved, remaining: summary.remaining },
    { consumed: 0, reserved: 12, remaining: 8 },
  );
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

test('usage endpoint is session-scoped and read-only', async () => {
  const redis = fakeRedis();
  const meter = createRoomMeter({ command: redis.command, now, config: { creditsLimit: 20 } });
  const handler = createUsageHandler({ resolveUser: async () => 'alice', meter });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.usage.limit, 20);

  const denied = response();
  await createUsageHandler({ resolveUser: async () => null, meter })({ method: 'GET' }, denied);
  assert.equal(denied.code, 401);
});
