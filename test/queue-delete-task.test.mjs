import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { approveQueueItem } = await import('../lib/queue.js');

test('approveQueueItem executes a queued delete_board_task by calling deleteTask', async () => {
  const queuedItem = {
    id: 'q1',
    tool: 'delete_board_task',
    input: { id: 'task-abc' },
    description: 'Delete stale test task',
    created_at: 1,
  };
  const storedTask = JSON.stringify({ id: 'task-abc', title: 'TEST — Claude Routine wake' });

  const calls = [];
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    calls.push(command);
    if (command[0] === 'HGET' && command[1] === 'nex:queue') {
      return { ok: true, async json() { return { result: JSON.stringify(queuedItem) }; } };
    }
    if (command[0] === 'HGET' && command[1] === 'nexus:board:tasks') {
      return { ok: true, async json() { return { result: storedTask }; } };
    }
    if (command[0] === 'HDEL') {
      return { ok: true, async json() { return { result: 1 }; } };
    }
    throw new Error(`unexpected command ${JSON.stringify(command)}`);
  };

  const { item, result } = await approveQueueItem('q1');
  assert.equal(item.tool, 'delete_board_task');
  assert.deepEqual(result, { id: 'task-abc', title: 'TEST — Claude Routine wake', deleted: true });

  // Confirms the real deletion (board tasks HDEL) and the queue cleanup
  // (queue HDEL) both actually happened, not just the queue-side bookkeeping.
  const hdelCommands = calls.filter((c) => c[0] === 'HDEL');
  assert.equal(hdelCommands.length, 2);
  assert.ok(hdelCommands.some((c) => c[1] === 'nexus:board:tasks' && c[2] === 'task-abc'));
  assert.ok(hdelCommands.some((c) => c[1] === 'nex:queue' && c[2] === 'q1'));
});

test('approveQueueItem surfaces a clear error when the queued task id no longer exists', async () => {
  const queuedItem = {
    id: 'q2',
    tool: 'delete_board_task',
    input: { id: 'already-gone' },
    description: 'Delete something already removed',
    created_at: 1,
  };
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'HGET' && command[1] === 'nex:queue') {
      return { ok: true, async json() { return { result: JSON.stringify(queuedItem) }; } };
    }
    if (command[0] === 'HGET' && command[1] === 'nexus:board:tasks') {
      return { ok: true, async json() { return { result: null }; } };
    }
    throw new Error(`unexpected command ${JSON.stringify(command)}`);
  };

  await assert.rejects(() => approveQueueItem('q2'), /Task not found: already-gone/);
});
