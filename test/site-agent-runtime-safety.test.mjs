import test from 'node:test';
import assert from 'node:assert/strict';

import { CONSUME_SCRIPT } from '../lib/siteAgent.js';
import { createSiteAgentHandler } from '../api/site-agent-chat.js';

function response() {
  return {
    headers: {}, code: 0, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

const request = () => ({
  method: 'POST',
  body: { projectId: 'client_site_1', message: 'What are your hours?' },
  headers: { 'x-forwarded-for': '203.0.113.10' },
  socket: {},
});

function make(overrides = {}) {
  return createSiteAgentHandler({
    readConfig: async () => ({ enabled: true, username: 'alice' }),
    consumeReply: async () => ({ allowed: true }),
    rateLimit: async () => ({ allowed: true }),
    readBuild: async () => ({ html: '<main>Open weekdays</main>' }),
    modelApiKey: 'test-key',
    callModel: async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'We are open weekdays.' }] }),
    }),
    ...overrides,
  });
}

test('runtime meter checks monthly and daily ceilings before incrementing', () => {
  assert.match(CONSUME_SCRIPT, /monthlyUsed >= monthlyLimit/);
  assert.match(CONSUME_SCRIPT, /dailyUsed >= dailyLimit/);
  assert.ok(CONSUME_SCRIPT.indexOf('monthlyUsed >= monthlyLimit') < CONSUME_SCRIPT.indexOf("redis.call('INCR', KEYS[1])"));
  assert.ok(CONSUME_SCRIPT.indexOf('dailyUsed >= dailyLimit') < CONSUME_SCRIPT.indexOf("redis.call('INCR', KEYS[2])"));
});

test('exhausted runtime quota returns a static 200 and never calls the model', async () => {
  let modelCalls = 0;
  const handler = make({
    consumeReply: async () => ({ allowed: false, reason: 'monthly_limit_reached' }),
    callModel: async () => { modelCalls += 1; throw new Error('must not run'); },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.atCapacity, true);
  assert.equal(res.body.capacityReason, 'monthly_limit_reached');
  assert.equal(modelCalls, 0);
});

test('daily ceiling blocks bursts without breaking the client widget', async () => {
  let modelCalls = 0;
  const handler = make({
    consumeReply: async () => ({ allowed: false, reason: 'daily_limit_reached' }),
    callModel: async () => { modelCalls += 1; throw new Error('must not run'); },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.atCapacity, true);
  assert.equal(modelCalls, 0);
});

test('meter failure fails closed and never calls the model', async () => {
  let modelCalls = 0;
  const handler = make({
    consumeReply: async () => ({ allowed: false, reason: 'meter_unavailable' }),
    callModel: async () => { modelCalls += 1; throw new Error('must not run'); },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.atCapacity, true);
  assert.equal(res.body.capacityReason, 'meter_unavailable');
  assert.equal(modelCalls, 0);
});

test('successful metering allows one bounded model reply', async () => {
  let modelCalls = 0;
  const handler = make({
    callModel: async () => {
      modelCalls += 1;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Weekdays.' }] }) };
    },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.message, 'Weekdays.');
  assert.equal(modelCalls, 1);
});
