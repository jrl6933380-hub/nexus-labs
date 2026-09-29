import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://forge-brain-empty-test.invalid';
process.env.KV_REST_API_TOKEN = 'test';
process.env.FORGE_ENCRYPTION_KEY = 'a'.repeat(64);

const records = new Map();
const calls = [];
global.fetch = async (url, options = {}) => {
  if (url.startsWith(process.env.KV_REST_API_URL)) {
    const [, action, key] = new URL(url).pathname.split('/');
    if (action === 'set') records.set(decodeURIComponent(key), options.body);
    return { ok:true, json:async () => ({ result: action === 'get' ? records.get(decodeURIComponent(key)) ?? null : 'OK' }) };
  }
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  calls.push(JSON.parse(options.body));
  return { ok:true, json:async () => calls.length === 1
    ? { choices:[{ finish_reason:'length', message:{ content:'' } }], usage:{ completion_tokens_details:{ reasoning_tokens:1800 } } }
    : { choices:[{ finish_reason:'stop', message:{ content:'{"kind":"build","message":"Building","instruction":"Board"}' } }] } };
};

const { saveConnection } = await import('../lib/forge/brainStore.js');
const { askCustomerBrain } = await import('../lib/forge/brainStream.js');

test('an empty visible free response retries once with a larger bounded budget', async () => {
  await saveConnection('tester', { provider:'openrouter', key:'test-key', tier:'free' });
  const result = await askCustomerBrain({ username:'tester', body:{ max_tokens:900, messages:[{ role:'user', content:'Build it' }] } });
  assert.match(result.text, /Building/);
  assert.deepEqual(calls.map((call) => call.max_tokens), [1800, 3000]);
  assert.ok(calls.every((call) => call.model === 'openrouter/free'));
});
