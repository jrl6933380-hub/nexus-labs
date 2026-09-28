import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPodUser, livePodBaseUrl, podRequestBody, _resetPodCacheForTests, POD_MODEL } from '../lib/forge/podBrain.js';

const env = { NEX_POD_USERS: 'Nexus-forge-owner, james', RUNPOD_API_KEY: 'rp', NEX_POD_KEY: 'pk' };

test('only listed users are pod users (case-insensitive)', () => {
  assert.equal(isPodUser('nexus-forge-owner', env), true);
  assert.equal(isPodUser('JAMES', env), true);
  assert.equal(isPodUser('someone-else', env), false);
  assert.equal(isPodUser('', env), false);
  assert.equal(isPodUser('james', {}), false);
});

test('"*" lets every signed-in account use the pod', () => {
  const all = { NEX_POD_USERS: '*' };
  assert.equal(isPodUser('anyone', all), true);
  assert.equal(isPodUser('James', all), true);
  assert.equal(isPodUser('', all), false);
});

test('live pod: running nex-pod that passes health check returns its /v1 url', async () => {
  _resetPodCacheForTests();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts?.headers?.Authorization });
    if (url.endsWith('/pods')) return { ok: true, json: async () => [{ id: 'abc', name: 'nex-pod', desiredStatus: 'RUNNING' }] };
    return { ok: true };
  };
  const url = await livePodBaseUrl({ fetchImpl, env, now: 1_000_000 });
  assert.equal(url, 'https://abc-8000.proxy.runpod.net/v1');
  assert.equal(calls[0].auth, 'Bearer rp');
  assert.equal(calls[1].auth, 'Bearer pk');
});

test('no pod when stopped, missing, unhealthy, or keys unset', async () => {
  const cases = [
    { pods: [{ id: 'a', name: 'nex-pod', desiredStatus: 'EXITED' }], healthOk: true, env },
    { pods: [], healthOk: true, env },
    { pods: [{ id: 'a', name: 'nex-pod', desiredStatus: 'RUNNING' }], healthOk: false, env },
    { pods: [{ id: 'a', name: 'nex-pod', desiredStatus: 'RUNNING' }], healthOk: true, env: { NEX_POD_USERS: 'x' } },
  ];
  let t = 10_000_000;
  for (const c of cases) {
    _resetPodCacheForTests();
    const fetchImpl = async (url) => (url.endsWith('/pods') ? { ok: true, json: async () => c.pods } : { ok: c.healthOk });
    assert.equal(await livePodBaseUrl({ fetchImpl, env: c.env, now: (t += 100_000) }), null);
  }
});

test('never throws when RunPod is unreachable', async () => {
  _resetPodCacheForTests();
  const fetchImpl = async () => { throw new Error('network down'); };
  assert.equal(await livePodBaseUrl({ fetchImpl, env, now: 99_000_000 }), null);
});

test('pod request body targets nex-base with medium reasoning', () => {
  const body = podRequestBody({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
  assert.equal(body.model, POD_MODEL);
  assert.equal(body.stream, true);
  assert.deepEqual(body.chat_template_kwargs, { reasoning_effort: 'medium' });
});
