import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://redis.memory-manager.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const hashes = new Map();
const lists = new Map();

function hash(name) {
  if (!hashes.has(name)) hashes.set(name, new Map());
  return hashes.get(name);
}

globalThis.fetch = async (_url, options) => {
  const [command, key, ...args] = JSON.parse(options.body);
  let result = null;
  if (command === 'HSET') {
    hash(key).set(args[0], args[1]);
    result = 1;
  } else if (command === 'HGET') {
    result = hash(key).get(args[0]) || null;
  } else if (command === 'HGETALL') {
    result = [...hash(key).entries()].flat();
  } else if (command === 'HLEN') {
    result = hash(key).size;
  } else if (command === 'HDEL') {
    result = hash(key).delete(args[0]) ? 1 : 0;
  } else if (command === 'LPUSH') {
    const values = lists.get(key) || [];
    values.unshift(args[0]);
    lists.set(key, values);
    result = values.length;
  } else if (command === 'LTRIM') {
    const values = lists.get(key) || [];
    lists.set(key, values.slice(Number(args[0]), Number(args[1]) + 1));
    result = 'OK';
  } else {
    throw new Error(`Unexpected Redis command: ${command}`);
  }
  return { ok: true, json: async () => ({ result }) };
};

const {
  addMemory,
  curatePendingMemories,
  listMemories,
  listMemoryCandidates,
  normalizeMemory,
  parseCuratorDecision,
  rankMemories,
  stageExchangeForMemory,
} = await import('../lib/memory.js');

test('legacy records receive safe structured defaults', () => {
  const memory = normalizeMemory({ id: 'legacy', content: 'Old fact', category: 'fact' });
  assert.equal(memory.claim, 'Old fact');
  assert.equal(memory.scope, 'profile');
  assert.equal(memory.provenance, 'legacy');
  assert.equal(memory.status, 'active');
});

test('curator parser accepts only bounded structured memories', () => {
  const decision = parseCuratorDecision('```json\n{"memories":[{"content":"Prefers concise answers","scope":"preference","provenance":"stated","confidence":0.9,"tags":["answers"]}]}\n```');
  assert.equal(decision.memories.length, 1);
  assert.equal(decision.memories[0].scope, 'preference');
  assert.equal(decision.memories[0].provenance, 'stated');
});

test('completed exchanges remain candidates until reviewed', async () => {
  const candidate = await stageExchangeForMemory({ userMessage: 'I prefer concise answers.', assistantReply: 'Understood.' });
  assert.equal(candidate.status, 'pending');
  assert.deepEqual((await listMemoryCandidates()).map((item) => item.id), [candidate.id]);
  assert.equal((await listMemories()).length, 0);
});

test('curation promotes user-stated facts and supersedes conflicting active memory', async () => {
  const old = await addMemory('The preferred color is blue.', 'fact', ['color'], { provenance: 'stated', scope: 'preference' });
  const candidate = await stageExchangeForMemory({ userMessage: 'Correction: my preferred color is green.', assistantReply: 'I will use green.' });
  const result = await curatePendingMemories({
    force: true,
    curator: async () => ({
      memories: [{
        content: 'The preferred color is green.',
        category: 'fact',
        scope: 'preference',
        provenance: 'stated',
        confidence: 1,
        tags: ['color'],
        supersedes_id: old.id,
      }],
    }),
  });
  assert.equal(result.created, 1);
  const all = await listMemories();
  assert.equal(all.find((item) => item.id === old.id).status, 'superseded');
  assert.equal(all.find((item) => item.content.includes('green')).status, 'active');
  assert.ok(!rankMemories(all, 'color').some((item) => item.id === old.id));
  assert.equal((await listMemoryCandidates()).some((item) => item.id === candidate.id), false);
});

test('a transient curator failure remains pending for retry', async () => {
  const candidate = await stageExchangeForMemory({ userMessage: 'I use the metric system.', assistantReply: 'Noted.' });
  await curatePendingMemories({ force: true, limit: 1, curator: async () => { throw new Error('temporary gateway outage'); } });
  const pending = await listMemoryCandidates();
  const retriable = pending.find((item) => item.id === candidate.id);
  assert.ok(retriable);
  assert.equal(retriable.attempts, 1);
});

test('compression never reactivates superseded memories', async () => {
  const old = normalizeMemory({ id: 'old', content: 'Use the retired design.', status: 'superseded', created_at: 1 });
  const current = normalizeMemory({ id: 'current', content: 'Use the current design.', status: 'active', created_at: 2 });
  assert.deepEqual(rankMemories([old, current], 'design').map((item) => item.id), ['current']);
});
