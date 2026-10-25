import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchRenderWorker } from '../lib/adRenderDispatch.js';
import { createRenderJobStore } from '../lib/adRenderJobs.js';
import { promoVideo } from '../lib/adMotionKit.js';

test('does nothing without a token', async () => {
  let called = false;
  const r = await dispatchRenderWorker({ env: {}, fetchImpl: async () => { called = true; } });
  assert.deepEqual(r, { dispatched: false, reason: 'NOT_CONFIGURED' }); assert.equal(called, false);
});

test('posts one workflow_dispatch to main and reports success on 204', async () => {
  let seen;
  const r = await dispatchRenderWorker({ env: { NEXUS_RENDER_DISPATCH_TOKEN: 'tok' }, fetchImpl: async (url, init) => { seen = { url, init }; return { status: 204 }; } });
  assert.deepEqual(r, { dispatched: true });
  assert.match(seen.url, /\/actions\/workflows\/render-worker\.yml\/dispatches$/);
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(seen.init.body), { ref: 'main' });
});

test('failures are reported without the token and never throw', async () => {
  assert.deepEqual(await dispatchRenderWorker({ env: { NEXUS_RENDER_DISPATCH_TOKEN: 'secret-tok' }, fetchImpl: async () => ({ status: 403 }) }), { dispatched: false, reason: 'GITHUB_403' });
  const r = await dispatchRenderWorker({ env: { NEXUS_RENDER_DISPATCH_TOKEN: 'secret-tok' }, fetchImpl: async () => { throw new Error('boom secret-tok'); } });
  assert.deepEqual(r, { dispatched: false, reason: 'NETWORK' });
  assert.ok(!JSON.stringify(r).includes('secret-tok'));
});

test('queueing a job calls onQueued once, and a failing hook never blocks the job', async () => {
  const h = new Map(), kv = new Map();
  const command = async ([op, key, ...r]) => { const m = h.get(key) || new Map();
    if (op === 'HSET') { h.set(key, m); m.set(r[0], r[1]); return 1; }
    if (op === 'HVALS') return [...m.values()]; if (op === 'SET') { kv.set(key, r[0]); return 'OK'; } if (op === 'HGET') return m.get(r[0]) ?? null; return 0; };
  let calls = 0;
  const store = createRenderJobStore({ command, onQueued: () => { calls++; } });
  const job = await store.create('u', { kind: 'still', project: promoVideo({ brand: 'N', hook: 'Hi', cta: 'Go' }), options: {} });
  assert.equal(calls, 1); assert.equal(job.status, 'queued');
  const bad = createRenderJobStore({ command, onQueued: () => { throw new Error('x'); } });
  assert.equal((await bad.create('u', { kind: 'still', project: promoVideo({ brand: 'N', hook: 'Hi', cta: 'Go' }), options: {} })).status, 'queued');
});
