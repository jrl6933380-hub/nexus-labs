import test from 'node:test';
import assert from 'node:assert/strict';

const { analyzeBoardHygiene, createCleanupService } = await import('../lib/cleanupAgent.js');

test('Cleaner reports only concrete board integrity signals', () => {
  const report = analyzeBoardHygiene({
    tasks: [
      { id: 'old', title: 'Old blocker', stale_check: { flagged: true } },
      { id: 'dupe', title: 'Duplicate', duplicate_check: { flagged: true } },
      { id: 'claim', title: 'Premature complete', claim_check: { flagged: true } },
      { id: 'clean', title: 'Fine' },
    ],
  }, 123);

  assert.deepEqual(report.counts, { stale_blocked: 1, duplicates: 1, completion_mismatches: 1 });
  assert.equal(report.findings.length, 3);
  assert.equal(report.checked_at, 123);
});

test('Cleaner posts once per changed finding set and never mutates tasks', async () => {
  const board = { tasks: [{ id: 'old', title: 'Old blocker', stale_check: { flagged: true } }] };
  const posted = [];
  const cleaner = createCleanupService({
    readBoard: async () => board,
    postMessage: async (message) => posted.push(message),
    now: () => 456,
  });

  const first = await cleaner.sweep();
  const second = await cleaner.sweep();
  board.tasks = [];

  const resolved = await cleaner.sweep();

  assert.equal(first.posted, true);
  assert.equal(second.posted, false);
  assert.equal(resolved.posted, false);
  assert.equal(posted.length, 1);
  assert.equal(board.tasks.length, 0);
});
