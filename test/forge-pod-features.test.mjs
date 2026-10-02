import test from 'node:test';
import assert from 'node:assert/strict';
import { getFeatureConnection, usesPodBrain } from '../lib/forge/featureConnection.js';
import { canUseFeature } from '../lib/forge/features.js';
import { createForgeBriefHandler } from '../api/forge-brief.js';

const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const brief = { version: 1, owner: 'alice', project_id: 'site', status: 'interviewing', answers: {}, comments: {} };

test('Qwen-only runtime unlocks all four features without reading a legacy connection', async () => {
  const connection = await getFeatureConnection('alice', { env: { NEX_QWEN_ONLY: 'true' }, connectionFor: async () => { throw Error('legacy store unavailable'); } });
  assert.equal(connection.provider, 'nex-pod');
  assert.equal(connection.tested_at, null, 'runtime selection does not claim live health');
  for (const feature of ['build', 'edit', 'brief', 'stack']) assert.equal(canUseFeature(connection, feature).allowed, true);
});

test('pod rollout is scoped to the configured accounts and never grants guest access', async () => {
  const env = { NEX_POD_USERS: 'alice' };
  assert.equal(usesPodBrain('alice', env), true);
  assert.equal(usesPodBrain('bob', env), false);
  assert.equal(usesPodBrain(null, { NEX_QWEN_ONLY: 'true', NEX_POD_USERS: '*' }), false);
  const legacy = { connected: true, tier: 'free' };
  assert.equal(await getFeatureConnection('bob', { env, connectionFor: async () => legacy }), legacy);
  assert.equal(canUseFeature(legacy, 'brief').allowed, false);
});

test('planner GET and answer use the pod runtime without a legacy connection', async () => {
  const calls = [];
  const handler = createForgeBriefHandler({
    env: { NEX_QWEN_ONLY: 'true' }, resolveUser: async () => 'alice',
    connectionFor: async () => { throw Error('no OpenRouter key'); },
    ensure: async input => { calls.push(input); return brief; },
    answer: async input => { calls.push(input); return brief; },
  });
  for (const req of [
    { method: 'GET', query: { projectId: 'site' } },
    { method: 'POST', body: { projectId: 'site', action: 'answer', questionId: 'idea', values: ['A bakery'] } },
  ]) {
    const res = response(); await handler(req, res); assert.equal(res.code, 200);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every(input => input.ownerUsername === 'alice' && input.projectId === 'site'));
});

test('planner still rejects guests and legacy free-tier connections', async () => {
  for (const [user, code] of [[null, 401], ['alice', 402]]) {
    const handler = createForgeBriefHandler({ env: {}, resolveUser: async () => user, connectionFor: async () => ({ connected: true, tier: 'free' }) });
    const res = response(); await handler({ method: 'GET', query: {} }, res); assert.equal(res.code, code);
  }
});

const { createForgeBrainHandler } = await import('../api/forge-brain.js');

test('brain status advertises the pod capability without legacy provider setup', async () => {
  const handler = createForgeBrainHandler({ resolveUser: async () => 'alice', featureConnectionFor: user => getFeatureConnection(user, { env: { NEX_QWEN_ONLY: 'true' } }) });
  const res = response(); await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.connected, true);
  assert.equal(res.body.provider, 'nex-pod');
  assert.equal(res.body.tier, 'strong');
  assert.deepEqual(res.body.providers, []);
  assert.equal(res.body.tested_at, null);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('pod brain checks report live health and refuse obsolete provider actions', async () => {
  for (const available of [true, false]) {
    const handler = createForgeBrainHandler({ resolveUser: async () => 'alice', podFor: () => true, podBaseFor: async () => available ? 'https://pod.example/v1' : null });
    const res = response(); await handler({ method: 'POST', body: { action: 'test' } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.ok, available);
    const obsolete = response(); await handler({ method: 'POST', body: { action: 'authorize' } }, obsolete);
    assert.equal(obsolete.code, 400); assert.match(obsolete.body.error, /No separate Builder Brain/);
  }
});

test('pod brain status still requires a signed-in session', async () => {
  const handler = createForgeBrainHandler({ resolveUser: async () => null });
  const res = response(); await handler({ method: 'GET' }, res); assert.equal(res.code, 401);
});

test('Connections marks the pod ready only after a live health check', async () => {
  const { createMemoryStore } = await import('../lib/forgeStack.js');
  const { runStackAction } = await import('../lib/forge/stackActions.js');
  const { _resetPodCacheForTests } = await import('../lib/forge/podBrain.js');
  const keys = ['NEX_QWEN_ONLY', 'RUNPOD_API_KEY', 'NEX_POD_KEY'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  try {
    process.env.NEX_QWEN_ONLY = 'true'; process.env.RUNPOD_API_KEY = 'test'; process.env.NEX_POD_KEY = 'test';
    for (const healthy of [false, true]) {
      _resetPodCacheForTests();
      globalThis.fetch = async url => url.endsWith('/pods')
        ? { ok: true, json: async () => [{ id: 'test-pod', name: 'nex-pod', desiredStatus: 'RUNNING' }] }
        : { ok: healthy };
      const result = await runStackAction({ ownerUsername: 'alice', projectId: 'site', slotId: 'brain', operation: 'verify', store: createMemoryStore() });
      assert.equal(result.ok, healthy);
      assert.equal(result.manifest.slots.brain.status === 'ready', healthy);
      if (healthy) assert.equal(result.manifest.slots.brain.metadata.provider, 'nex-pod');
    }
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
    _resetPodCacheForTests();
  }
});
