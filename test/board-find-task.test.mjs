import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { findBoardTask } = await import('../lib/board.js');

function mockHgetall(entries) {
  const flat = [];
  for (const task of entries) flat.push(task.id, JSON.stringify(task));
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    const result = command[0] === 'HGETALL' ? flat : null;
    return { ok: true, async json() { return { result }; } };
  };
}

test('finds a task by a substring of its title, case-insensitively', async () => {
  mockHgetall([
    { id: 'a1', title: 'Ship Nex progressive tool architecture', description: '', status: 'planning', owner: 'chatgpt', created_at: 1, updated_at: 1 },
    { id: 'a2', title: 'Validate live runtime usage cap under real traffic', description: '', status: 'planning', owner: 'nex', created_at: 2, updated_at: 2 },
  ]);

  const matches = await findBoardTask({ query: 'PROGRESSIVE tool' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'a1');
  assert.equal(matches[0].status, 'planning');
  assert.equal(matches[0].owner, 'chatgpt');
});

test('matches against description too, not just title', async () => {
  mockHgetall([
    { id: 'b1', title: 'Some vague title', description: 'covers the skills matcher stopword fix', status: 'complete', owner: 'nex', created_at: 1, updated_at: 1 },
  ]);

  const matches = await findBoardTask({ query: 'stopword fix' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'b1');
});

test('status filter narrows results', async () => {
  mockHgetall([
    { id: 'c1', title: 'Duplicate name task', description: '', status: 'planning', owner: 'nex', created_at: 1, updated_at: 1 },
    { id: 'c2', title: 'Duplicate name task', description: '', status: 'complete', owner: 'claude', created_at: 2, updated_at: 2 },
  ]);

  const matches = await findBoardTask({ query: 'duplicate name', status: 'complete' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'c2');
});

test('empty query throws instead of returning everything', async () => {
  mockHgetall([{ id: 'd1', title: 'Anything', description: '', status: 'idle', owner: null, created_at: 1, updated_at: 1 }]);
  await assert.rejects(() => findBoardTask({ query: '' }));
});

test('no match returns an empty array, not an error', async () => {
  mockHgetall([{ id: 'e1', title: 'Totally unrelated task', description: '', status: 'idle', owner: null, created_at: 1, updated_at: 1 }]);
  const matches = await findBoardTask({ query: 'nonexistent keyword' });
  assert.deepEqual(matches, []);
});
