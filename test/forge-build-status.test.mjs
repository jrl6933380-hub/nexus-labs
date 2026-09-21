import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildStatusHandler } from '../api/forge-build-status.js';
import { createBuildJob, finishBuildJob, getBuildJob } from '../lib/forge/buildJobs.js';

function response() {
  return {
    headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.value = value; return this; },
  };
}

test('status endpoint never reads a job for an unsigned customer', async () => {
  let reads = 0;
  const handler = createBuildStatusHandler({ resolveUser: async () => null, getJob: async () => { reads++; } });
  const res = response();
  await handler({ method: 'GET', query: { projectId: 'site' } }, res);
  assert.equal(res.code, 401);
  assert.equal(reads, 0);
});

test('status lookup uses the authenticated owner and exact project', async () => {
  const seen = [];
  const handler = createBuildStatusHandler({
    resolveUser: async () => 'alice',
    getJob: async (...args) => { seen.push(args); return null; },
  });
  const res = response();
  await handler({ method: 'GET', query: { projectId: 'site', jobId: 'job' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(seen, [['alice', 'site', 'job']]);
});

test('an abandoned background job eventually reports failure instead of spinning forever', async () => {
  const handler = createBuildStatusHandler({
    resolveUser: async () => 'alice',
    getJob: async () => ({ id: 'job', projectId: 'site', status: 'building', createdAt: Date.now() - 7 * 60_000 }),
  });
  const res = response();
  await handler({ method: 'GET', query: { projectId: 'site' } }, res);
  assert.equal(res.value.job.status, 'failed');
});

test('background status persists without page HTML or provider key and is owner scoped', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.KV_REST_API_URL;
  const oldToken = process.env.KV_REST_API_TOKEN;
  const kv = new Map();
  process.env.KV_REST_API_URL = 'https://kv.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  globalThis.fetch = async (_url, options) => {
    const [action, key, value] = JSON.parse(options.body);
    if (action === 'SET') kv.set(key, value);
    return { ok: true, json: async () => ({ result: action === 'GET' ? kv.get(key) ?? null : 'OK' }) };
  };
  try {
    const job = await createBuildJob('alice', 'site');
    assert.equal((await getBuildJob('alice', 'site', job.id)).status, 'building');
    assert.equal(await getBuildJob('bob', 'site', job.id), null);
    assert.equal(await getBuildJob('alice', 'other', job.id), null);
    await finishBuildJob('alice', job, 'complete', { buildId: 'saved-1' });
    assert.equal((await getBuildJob('alice', 'site')).buildId, 'saved-1');
    assert.ok(![...kv.values()].join('').includes('sk-or-'));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = oldUrl;
    if (oldToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = oldToken;
  }
});
