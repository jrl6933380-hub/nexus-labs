import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishHandler } from '../api/room-publish.js';

function response() {
  return { headers: {}, code: 0, body: null,
    setHeader(k,v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const request = (body = { id: 'a1' }) => ({ method: 'POST', body });
const make = (overrides = {}) => createPublishHandler({
  resolveUser: async () => 'alice',
  readBuild: async (owner, id) => (owner === 'alice' && id === 'a1' ? { html: '<h1>hi</h1>', projectId: 'p1' } : null),
  resolvePlan: async () => 'hosted',
  publish: async () => ({ deployed: true, url: 'https://room-alice-p1.vercel.app', deployment_id: 'dpl_1' }),
  ...overrides,
});

test('requires a session', async () => {
  const handler = createPublishHandler({ resolveUser: async () => null });
  const res = response(); await handler(request(), res);
  assert.equal(res.code, 401);
});

test('free-tier accounts cannot publish', async () => {
  const res = response();
  await make({ resolvePlan: async () => 'free' })(request(), res);
  assert.equal(res.code, 402);
  assert.equal(res.body.code, 'PUBLISH_REQUIRES_PAID_PLAN');
});

test('missing/invalid build id is rejected', async () => {
  for (const body of [{}, { id: 123 }, { id: '' }]) {
    const res = response();
    await make()({ method: 'POST', body }, res);
    assert.equal(res.code, 400);
  }
});

test('unknown build id returns 404', async () => {
  const res = response();
  await make({ readBuild: async () => null })(request(), res);
  assert.equal(res.code, 404);
});

test('a build with no html cannot be published', async () => {
  const res = response();
  await make({ readBuild: async () => ({ html: '' }) })(request(), res);
  assert.equal(res.code, 422);
});

test('paid accounts publish successfully and get back a real url', async () => {
  const res = response();
  await make()(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.url, 'https://room-alice-p1.vercel.app');
  assert.equal(res.body.deployment_id, 'dpl_1');
});

test('a failed publish returns 502 with the reason', async () => {
  const res = response();
  await make({ publish: async () => ({ deployed: false, reason: 'No Vercel token configured' }) })(request(), res);
  assert.equal(res.code, 502);
  assert.equal(res.body.reason, 'No Vercel token configured');
});

test('non-POST requests are rejected', async () => {
  const res = response();
  await make()({ method: 'GET' }, res);
  assert.equal(res.code, 405);
});

test('project name is slugged from username and project id, lowercase and hyphenated', async () => {
  let capturedName = null;
  const res = response();
  await make({
    readBuild: async () => ({ html: '<h1>hi</h1>', projectId: 'My_Project 1' }),
    publish: async ({ projectName }) => { capturedName = projectName; return { deployed: true, url: 'https://x.vercel.app', deployment_id: 'dpl_2' }; },
  })(request(), res);
  assert.equal(res.code, 200);
  assert.match(capturedName, /^[a-z0-9-]+$/);
  assert.match(capturedName, /^room-alice-/);
});
