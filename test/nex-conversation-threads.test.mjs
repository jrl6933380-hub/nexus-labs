import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const hashes = new Map();
const originalFetch = global.fetch;
global.fetch = async (_url, options) => {
  const [command, key, ...args] = JSON.parse(options.body);
  const hash = hashes.get(key) || new Map();
  let result = null;
  if (command === 'HSET') {
    hash.set(args[0], args[1]);
    hashes.set(key, hash);
    result = 1;
  } else if (command === 'HGET') {
    result = hash.get(args[0]) || null;
  } else if (command === 'HGETALL') {
    result = [...hash.entries()].flat();
  } else if (command === 'HDEL') {
    result = args.reduce((count, id) => count + Number(hash.delete(id)), 0);
  }
  return { ok: true, json: async () => ({ result }) };
};

const {
  deleteConversationThread,
  listConversationThreads,
  loadConversationThread,
  saveConversationThread,
  THREAD_LIMIT,
  THREAD_MESSAGE_LIMIT,
} = await import(`../lib/nexConversationStore.js?threads=${Date.now()}`);

test.after(() => { global.fetch = originalFetch; });

test('cloud threads keep conversations isolated and return newest first', async () => {
  await saveConversationThread('mrlopez', { id:'first', updated_at:1, messages:[{ role:'user', content:'First idea' }] });
  await saveConversationThread('mrlopez', { id:'second', updated_at:2, messages:[{ role:'user', content:'Second idea' }] });

  assert.deepEqual((await loadConversationThread('mrlopez', 'first')).messages.map((item) => item.content), ['First idea']);
  assert.deepEqual((await loadConversationThread('mrlopez', 'second')).messages.map((item) => item.content), ['Second idea']);
  assert.deepEqual((await listConversationThreads('mrlopez')).map((item) => item.id), ['second', 'first']);
});

test('thread storage caps messages and prunes old threads', async () => {
  const messages = Array.from({ length:THREAD_MESSAGE_LIMIT + 3 }, (_, index) => ({ role:'user', content:`message ${index}` }));
  await saveConversationThread('capuser', { id:'latest', updated_at:1000, messages });
  assert.equal((await loadConversationThread('capuser', 'latest')).messages.length, THREAD_MESSAGE_LIMIT);

  for (let index = 0; index < THREAD_LIMIT + 3; index += 1) {
    await saveConversationThread('capuser', { id:`thread-${index}`, updated_at:index, messages:[{ role:'user', content:`thread ${index}` }] });
  }
  const listed = await listConversationThreads('capuser');
  assert.equal(listed.length, THREAD_LIMIT);
  assert.equal(listed.some((item) => item.id === 'thread-0'), false);
});

test('thread ids fail closed and deletion is scoped to the selected id', async () => {
  await assert.rejects(loadConversationThread('mrlopez', '../other'), /valid Nex conversation thread id/);
  assert.equal(await deleteConversationThread('mrlopez', 'first'), true);
  assert.equal(await loadConversationThread('mrlopez', 'first'), null);
  assert.ok(await loadConversationThread('mrlopez', 'second'));
});
