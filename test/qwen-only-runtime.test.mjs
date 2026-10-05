import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://qwen-only-test.invalid';
process.env.KV_REST_API_TOKEN = 'test';
process.env.FORGE_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NEX_QWEN_ONLY = 'true';
process.env.RUNPOD_API_KEY = 'rp';
process.env.NEX_POD_KEY = 'pk';
process.env.ROOM_EXEMPT_USER_IDS = 'tester,not-on-any-allowlist';

const records = new Map();
const calls = [];
const encoder = new TextEncoder();

function jsonResponse(json = {}, { ok = true, status = 200, body = null } = {}) {
  return {
    ok,
    status,
    body,
    headers: { get: () => 'application/json' },
    json: async () => json,
    text: async () => '',
  };
}

global.fetch = async (url, options = {}) => {
  calls.push(url);
  if (url.startsWith(process.env.KV_REST_API_URL)) {
    const [, action, key] = new URL(url).pathname.split('/');
    if (action === 'set') records.set(decodeURIComponent(key), options.body);
    return jsonResponse({ result: action === 'get' ? records.get(decodeURIComponent(key)) ?? null : 'OK' });
  }
  if (url === 'https://rest.runpod.io/v1/pods') {
    return jsonResponse([{ id: 'pod-1', name: 'nex-pod', desiredStatus: 'RUNNING' }]);
  }
  if (url.endsWith('/v1/models')) return jsonResponse();
  if (url.endsWith('/v1/chat/completions')) {
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'nex-base');
    if (request.stream === false) {
      return jsonResponse({
        model: 'nex-base',
        choices: [{ message: { content: '{"kind":"reply","message":"Ready on Qwen"}' } }],
      });
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"<html></html>"},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return jsonResponse({}, { body });
  }
  if (url.includes('openrouter.ai') || url.includes('ai-gateway.vercel.sh') || url.includes('api.anthropic.com')) {
    assert.fail(`Qwen-only runtime escaped to a hosted provider: ${url}`);
  }
  throw new Error(`unexpected fetch: ${url}`);
};

const { _resetPodCacheForTests } = await import('../lib/forge/podBrain.js');
const { askCustomerBrain, openBuildStream } = await import('../lib/forge/brainStream.js');

test('Forge assistant uses Qwen without requiring or calling OpenRouter', async () => {
  _resetPodCacheForTests();
  calls.length = 0;
  const result = await askCustomerBrain({
    username: 'tester',
    body: { max_tokens: 900, messages: [{ role: 'user', content: 'Talk to me' }] },
  });
  assert.equal(result.provider, 'nex-pod');
  assert.equal(result.model, 'nex-base');
  assert.match(result.text, /Ready on Qwen/);
  assert.equal(calls.some((url) => url.includes('openrouter.ai')), false);
});

test('Forge build uses Qwen for every signed-in user in Qwen-only mode', async () => {
  _resetPodCacheForTests();
  calls.length = 0;
  const result = await openBuildStream({
    username: 'not-on-any-allowlist',
    body: { max_tokens: 1000, messages: [{ role: 'user', content: 'Build it' }] },
    signal: new AbortController().signal,
  });
  assert.equal(result.provider, 'nex-pod');
  assert.equal(result.model, 'nex-base');
  assert.equal(calls.some((url) => url.includes('openrouter.ai')), false);
  await result.response.body.cancel();
});
