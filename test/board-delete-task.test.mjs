import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { deleteTask } = await import('../lib/board.js');

test('deleteTask removes an existing task and returns its title', async () => {
  const stored = JSON.stringify({ id: 'abc123', title: 'Old test task', status: 'complete' });
  let hdelCalled = null;
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'HGET') return { ok: true, async json() { return { result: stored }; } };
    if (command[0] === 'HDEL') { hdelCalled = command; return { ok: true, async json() { return { result: 1 }; } }; }
    throw new Error(`unexpected command ${command[0]}`);
  };

  const result = await deleteTask({ id: 'abc123' });
  assert.deepEqual(result, { id: 'abc123', title: 'Old test task', deleted: true });
  assert.deepEqual(hdelCalled, ['HDEL', 'nexus:board:tasks', 'abc123']);
});

test('deleteTask throws a clear error for a task id that does not exist', async () => {
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'HGET') return { ok: true, async json() { return { result: null }; } };
    throw new Error(`unexpected command ${command[0]}`);
  };
  await assert.rejects(() => deleteTask({ id: 'missing' }), /Task not found: missing/);
});

test('deleteTask throws when no id is given', async () => {
  await assert.rejects(() => deleteTask({}), /id is required/);
});
