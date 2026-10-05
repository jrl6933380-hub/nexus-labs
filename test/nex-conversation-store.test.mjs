import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('temporary Redis outage'); };

const {
  loadRecentConversation,
  saveRecentConversation,
} = await import(`../lib/nexConversationStore.js?fail-open=${Date.now()}`);

test.after(() => {
  global.fetch = originalFetch;
});

test('conversation persistence fails open during a transient Redis outage', async () => {
  assert.deepEqual(await loadRecentConversation('mrlopez'), []);
  await assert.doesNotReject(saveRecentConversation('mrlopez', [{ role: 'user', content: 'hello' }]));
});

test('invalid conversation identities still fail closed before storage access', async () => {
  await assert.rejects(loadRecentConversation('!'), /valid operator username/);
  await assert.rejects(saveRecentConversation('!', []), /valid operator username/);
});
