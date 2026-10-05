import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { annotateStaleBlockedTasks, listTasks } = await import('../lib/board.js');

test('flags only blocked tasks older than the configured threshold', () => {
  const now = 10_000_000;
  const tasks = [
    { id: 'stale', status: 'blocked', updated_at: now - 7_000 },
    { id: 'fresh', status: 'blocked', updated_at: now - 1_000 },
    { id: 'complete', status: 'complete', updated_at: now - 9_000 },
  ];
  const annotated = annotateStaleBlockedTasks(tasks, { now, thresholdMs: 5_000 });

  assert.deepEqual(annotated[0].stale_check, {
    flagged: true,
    blocked_for_ms: 7_000,
    threshold_ms: 5_000,
    checked_at: now,
  });
  assert.equal(annotated[1].stale_check, undefined);
  assert.equal(annotated[2].stale_check, undefined);
  assert.equal(tasks[0].stale_check, undefined, 'annotation must not mutate stored task data');
});

test('clears an old read-time flag when a task is no longer stale', () => {
  const [task] = annotateStaleBlockedTasks([{
    id: 'recovered',
    status: 'building',
    updated_at: 9_000,
    stale_check: { flagged: true },
  }], { now: 10_000, thresholdMs: 500 });

  assert.equal(task.stale_check, undefined);
});

test('listTasks surfaces the annotation without writing it back to Redis', async () => {
  const old = Date.now() - (7 * 60 * 60 * 1000);
  const commands = [];
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    commands.push(command);
    const result = command[0] === 'HGETALL'
      ? ['old-blocked', JSON.stringify({ id: 'old-blocked', status: 'blocked', created_at: old, updated_at: old })]
      : null;
    return { ok: true, async json() { return { result }; } };
  };

  const tasks = await listTasks();
  assert.equal(tasks[0].stale_check.flagged, true);
  assert.deepEqual(commands.map((command) => command[0]), ['HGETALL']);
});
