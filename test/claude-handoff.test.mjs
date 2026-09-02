import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDisengageCommand,
  isEngageCommand,
  startClaudeHandoff,
} from '../lib/claudeHandoff.js';

test('recognizes only explicit Nex handoff commands', () => {
  assert.equal(isDisengageCommand('Nex disengage'), true);
  assert.equal(isDisengageCommand('nex, disengage!'), true);
  assert.equal(isDisengageCommand('please disengage'), false);
  assert.equal(isDisengageCommand('Nex disengage and delete it'), false);
  assert.equal(isEngageCommand('Nex engage'), true);
  assert.equal(isEngageCommand('Nex re-engage.'), true);
});

test('creates a constrained board handoff and wakes Claude', async () => {
  const calls = [];
  const result = await startClaudeHandoff({
    createTaskFn: async (input) => {
      calls.push(['create', input]);
      return { id: 'task-123', ...input };
    },
    updateProgressFn: async (input) => calls.push(['update', input]),
    markBlockedFn: async (input) => calls.push(['blocked', input]),
    fireRoutineFn: async (envelope) => {
      calls.push(['wake', envelope]);
      return { session_id: 'session-1', session_url: 'https://claude.ai/session-1', replayed: false };
    },
    ledger: {},
  });

  assert.equal(result.wake.session_id, 'session-1');
  assert.match(calls[0][1].description, /read the entire shared Agent Board and BRIDGE\.md/);
  assert.match(calls[0][1].description, /not Nex/);
  assert.match(calls[0][1].description, /Do not edit files/);
  assert.deepEqual(calls[1][1], {
    task_id: 'task-123',
    trace_id: 'claude-handoff-task-123',
    idempotency_key: 'claude-handoff-task-123',
  });
  assert.equal(calls[2][1].status, 'building');
});

test('marks the handoff task blocked when Claude cannot be woken', async () => {
  let blocked;
  await assert.rejects(
    startClaudeHandoff({
      createTaskFn: async (input) => ({ id: 'task-456', ...input }),
      updateProgressFn: async () => {},
      markBlockedFn: async (input) => { blocked = input; },
      fireRoutineFn: async () => { throw new Error('routine unavailable'); },
      ledger: {},
    }),
    /routine unavailable/
  );
  assert.deepEqual(blocked, {
    id: 'task-456',
    reason: 'Claude takeover wake failed: routine unavailable',
  });
});
