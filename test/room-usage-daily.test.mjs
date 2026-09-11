import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageHandler } from '../api/room-usage.js';

function response() {
  return { code: 0, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeMeter({ percentRemaining = 40, unlimitedDaily = false, limit = 20 } = {}) {
  return {
    async getUsageSummary() { return { limit, consumed: 0, reserved: 0, remaining: limit }; },
    async getDailyUsageSummary() {
      return unlimitedDaily
        ? { unlimited: true, percentRemaining: 100, limit: null, remaining: null }
        : { unlimited: false, percentRemaining, limit: 100, remaining: Math.round(percentRemaining) };
    },
  };
}

test('usage endpoint includes a slim daily bar payload alongside the existing monthly usage', async () => {
  const handler = createUsageHandler({ resolveUser: async () => 'alice', meter: fakeMeter({ percentRemaining: 42 }) });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.daily.percentRemaining, 42);
  assert.equal(res.body.daily.unlimited, false);
  assert.equal('limit' in res.body.daily, false);
  assert.equal('consumed' in res.body.daily, false);
  assert.equal('remaining' in res.body.daily, false);
});

test('exempt accounts report an unlimited daily bar at 100 percent', async () => {
  const handler = createUsageHandler({ resolveUser: async () => 'owner', meter: fakeMeter({ unlimitedDaily: true }) });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.daily.unlimited, true);
  assert.equal(res.body.daily.percentRemaining, 100);
});

test('signed-out requests are still rejected before touching the meter', async () => {
  const handler = createUsageHandler({ resolveUser: async () => null, meter: fakeMeter() });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 401);
});
