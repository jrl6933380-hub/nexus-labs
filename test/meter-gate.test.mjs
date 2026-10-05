import test from 'node:test';
import assert from 'node:assert/strict';

import { reserveModelCall, MeterRefusedError, meterRefusalMessage } from '../lib/forge/meterGate.js';

// Forge funds every model call now. There is no bring-your-own-key path, so
// there is no request that may legitimately skip the meter. These tests are
// about the failure DIRECTION: when anything is uncertain, refuse or
// over-count, never let an unrecorded call through.

function fakeMeter({ reserve, settle } = {}) {
  const calls = { reserved: [], settled: [] };
  return {
    calls,
    async reserveBuild(args) {
      calls.reserved.push(args);
      if (typeof reserve === 'function') return reserve(args);
      return { ok: true, reservationId: 'res-1', period: 1, reserved: 5 };
    },
    async settleBuild(args) {
      calls.settled.push(args);
      if (typeof settle === 'function') return settle(args);
      return { charged: 5 };
    },
  };
}

const notOperator = () => false;

test('a call with no account is refused rather than allowed through', async () => {
  await assert.rejects(
    () => reserveModelCall({ username: null, meter: fakeMeter(), isOperator: notOperator }),
    (error) => error instanceof MeterRefusedError,
  );
});

test('an unreachable meter refuses the call', async () => {
  const meter = fakeMeter({
    reserve: () => { throw new Error('Redis unreachable'); },
  });
  await assert.rejects(
    () => reserveModelCall({ username: 'dana', meter, isOperator: notOperator }),
    (error) => error.reason === 'meter_unavailable',
  );
  // The point: if we cannot record spend, we do not spend.
});

test('an exhausted budget refuses with the budget reason', async () => {
  const meter = fakeMeter({ reserve: () => ({ ok: false, reason: 'daily_budget_exhausted' }) });
  await assert.rejects(
    () => reserveModelCall({ username: 'dana', meter, isOperator: notOperator }),
    (error) => error.reason === 'daily_budget_exhausted',
  );
});

test('a successful reservation reserves exactly once and settles on demand', async () => {
  const meter = fakeMeter();
  const reservation = await reserveModelCall({ username: 'dana', kind: 'fresh', meter, isOperator: notOperator });

  assert.equal(meter.calls.reserved.length, 1);
  assert.equal(meter.calls.reserved[0].userId, 'dana');
  assert.equal(meter.calls.reserved[0].kind, 'fresh');

  await reservation.settle({ success: true });
  assert.equal(meter.calls.settled.length, 1);
  assert.equal(meter.calls.settled[0].reservationId, 'res-1');
});

test('settling twice only settles once', async () => {
  const meter = fakeMeter();
  const reservation = await reserveModelCall({ username: 'dana', meter, isOperator: notOperator });
  await reservation.settle({ success: true });
  await reservation.settle({ success: true });
  assert.equal(meter.calls.settled.length, 1,
    'continuedStream can report finished on more than one path; double settling must be harmless');
});

test('a settlement failure never propagates to the customer', async () => {
  const meter = fakeMeter({ settle: () => { throw new Error('Redis blip'); } });
  const reservation = await reserveModelCall({ username: 'dana', meter, isOperator: notOperator });
  // The build succeeded; a bookkeeping failure must not turn that into an
  // error the customer sees. The reservation expires on its TTL instead.
  await assert.doesNotReject(() => reservation.settle({ success: true }));
});

test('operator accounts are exempt and never reserve', async () => {
  const meter = fakeMeter();
  const reservation = await reserveModelCall({
    username: 'Mrlopez', meter, isOperator: (name) => name === 'Mrlopez',
  });
  assert.equal(reservation.exempt, true);
  assert.equal(meter.calls.reserved.length, 0);
  await assert.doesNotReject(() => reservation.settle({ success: true }));
});

test('free-tier enforcement is requested, so the platform ceiling applies', async () => {
  const meter = fakeMeter();
  await reserveModelCall({ username: 'dana', meter, isOperator: notOperator });
  assert.equal(meter.calls.reserved[0].isFreeTier, true,
    'the platform-wide daily ceiling is only enforced against free-tier requests');
});

test('every refusal reason produces customer-readable copy', () => {
  for (const reason of [
    'daily_budget_exhausted', 'budget_exhausted', 'global_ceiling_exceeded',
    'meter_unavailable', 'something-unexpected',
  ]) {
    const message = meterRefusalMessage(reason);
    assert.ok(message && message.length > 0, `${reason} must produce a message`);
    assert.ok(!message.includes('undefined'));
  }
});
