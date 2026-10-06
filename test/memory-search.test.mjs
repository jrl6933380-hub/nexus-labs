import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const stored = [
  { id: '1', content: 'Vercel deployment failed during build', category: 'project', tags: ['vercel', 'deployment'], created_at: 1 },
  { id: '2', content: 'Stripe billing and subscription configuration', category: 'project', tags: ['stripe', 'billing'], created_at: 2 },
  { id: '3', content: 'Connector capability gap requiring development review', category: 'capability_gap', created_at: 3 },
  { id: '4', content: 'The sandbox runner uses E2B compute', category: 'fact', created_at: 4 },
];

globalThis.fetch = async (_url, options) => {
  const command = JSON.parse(options.body);
  assert.equal(command[0], 'HGETALL');
  return {
    ok: true,
    json: async () => ({
      result: stored.flatMap((memory) => [memory.id, JSON.stringify(memory)]),
    }),
  };
};

const { rankMemories, searchMemories } = await import('../lib/memory.js');

test('returns relevant tagged memories and excludes unrelated memories', async () => {
  const results = await searchMemories('Fix the Vercel deployment', 8);
  assert.deepEqual(results.map((memory) => memory.id), ['3', '1']);
  assert.ok(!results.some((memory) => memory.id === '2'));
});

test('always includes capability-gap memories', async () => {
  const results = await searchMemories('E2B sandbox test', 8);
  assert.ok(results.some((memory) => memory.id === '3'));
  assert.ok(results.some((memory) => memory.id === '4'));
});

test('supports existing memories without tags', async () => {
  const results = await searchMemories('sandbox runner', 8);
  const existing = results.find((memory) => memory.id === '4');
  assert.ok(existing);
  assert.deepEqual(existing.tags, []);
});

test('Nex receives provider-neutral capability-gap memories', () => {
  const results = rankMemories(stored, 'connector capability', 8, { agent: 'nex' });
  assert.ok(results.some((memory) => memory.id === '3'));
});

test('legacy provider-specific gap records normalize without losing history', () => {
  const results = rankMemories([{id:'legacy',content:'Old gap record',category:'for_claude'}], 'unrelated', 8);
  assert.equal(results[0].category,'capability_gap');
});

test('matching project scope outranks unrelated project memories', () => {
  const results = rankMemories([
    { id: 'other', content: 'Use the deployment checklist', category: 'project', scope: 'project', project: 'other' },
    { id: 'nexus', content: 'Use the deployment checklist', category: 'project', scope: 'project', project: 'nexus-labs' },
  ], 'deployment checklist', 5, { agent: 'nex', project: 'nexus-labs' });
  assert.equal(results[0].id, 'nexus');
});
