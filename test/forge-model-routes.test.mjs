import test from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/forge-model-routes.js';

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('a signed-out caller gets 404, not 403', async () => {
  const res = makeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 404,
    'a 403 would confirm the endpoint exists and is worth attacking');
});

test('a signed-out caller never sees the model line-up', async () => {
  const res = makeRes();
  await handler({ method: 'GET', headers: {} }, res);
  const serialized = JSON.stringify(res.body || {});
  assert.ok(!serialized.includes('claude'), 'routes must not leak to non-operators');
});

test('a signed-out caller cannot write routes', async () => {
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: {},
    body: { routes: { free: { build: 'something/expensive', chat: 'something/expensive' } } },
  }, res);
  assert.equal(res.statusCode, 404);
  assert.notEqual(res.body?.ok, true);
});
