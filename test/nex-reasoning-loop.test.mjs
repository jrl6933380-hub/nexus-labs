import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReasoningState,
  formatReasoningState,
  recordReasoningToolResult,
  registerModelStep,
  registerReasoningToolCall,
  registerToolSearch,
  finalizeReasoningState,
} from '../lib/nexReasoningLoop.js';

test('reasoning state carries the task goal, completion conditions, and resumed work', () => {
  const state = createReasoningState({
    message: 'Fix the login route and test it.',
    plan: { lane: 'code', requireEvidence: ['source_read', 'relevant_tests'] },
    runState: {
      resumed: true,
      lastResult: 'Read api/login.js',
      nextSafeAction: 'Patch the route.',
      workingBranch: 'feature/login',
      filesTouched: ['api/login.js'],
    },
  });

  assert.equal(state.goal, 'Fix the login route and test it.');
  assert.deepEqual(state.acceptanceConditions, ['source_read', 'relevant_tests']);
  assert.equal(state.resumed, true);
  assert.match(formatReasoningState(state), /feature\/login/);
  assert.match(formatReasoningState(state), /Patch the route/);
});

test('tool search is bounded and duplicate searches are rejected', () => {
  const state = createReasoningState({ message: 'Build it.', budgets: { maxToolSearches: 2 } });
  assert.equal(registerToolSearch(state, 'coding').allowed, true);
  assert.equal(registerToolSearch(state, 'coding').allowed, false);
  assert.equal(registerToolSearch(state, 'deploy').allowed, true);
  assert.equal(registerToolSearch(state, 'billing').allowed, false);
});

test('the second identical tool failure blocks blind retries', () => {
  const state = createReasoningState({ message: 'Inspect the deployment.' });
  const call = { name: 'check_deployment_status', input: { owner: 'o', repo: 'r' } };
  assert.equal(registerReasoningToolCall(state, call).allowed, true);
  recordReasoningToolResult(state, call, { is_error: true, content: 'HTTP 503 upstream unavailable' });
  assert.equal(registerReasoningToolCall(state, call).allowed, true);
  recordReasoningToolResult(state, call, { is_error: true, content: 'HTTP 503 upstream unavailable' });
  assert.equal(state.status, 'blocked');
  assert.equal(registerReasoningToolCall(state, call).allowed, false);
});

test('changed nested tool input is a changed plan, not an identical retry', () => {
  const state = createReasoningState({ message: 'Inspect the deployment.' });
  const first = { name: 'inspect', input: { target: { region: 'iad1' } } };
  const second = { name: 'inspect', input: { target: { region: 'sfo1' } } };
  registerReasoningToolCall(state, first);
  recordReasoningToolResult(state, first, { is_error: true, content: 'deployment unavailable' });
  registerReasoningToolCall(state, second);
  recordReasoningToolResult(state, second, { is_error: true, content: 'deployment unavailable' });

  assert.notEqual(state.status, 'blocked');
});

test('completion is terminal only when required evidence is satisfied', () => {
  const state = createReasoningState({ message: 'Fix it.', plan: { lane: 'code' } });
  finalizeReasoningState(state, { status: 'incomplete', missing: ['relevant_tests'] });
  assert.equal(state.status, 'waiting');
  assert.deepEqual(state.missingEvidence, ['relevant_tests']);

  finalizeReasoningState(state, { status: 'verified', missing: [] });
  assert.equal(state.status, 'completed');
});

test('a controller block cannot be overwritten by an empty completion receipt', () => {
  const state = createReasoningState({ message: 'Fix it.' });
  state.status = 'blocked';
  state.blocker = 'repeated_failure:run_sandbox';

  finalizeReasoningState(state, { status: 'not_required', missing: [] });

  assert.equal(state.status, 'blocked');
  assert.equal(state.blocker, 'repeated_failure:run_sandbox');
});

test('budget exhaustion pauses both model and tool execution until resume', () => {
  const state = createReasoningState({ message: 'Keep going.', budgets: { maxToolCalls: 1 } });
  assert.equal(registerReasoningToolCall(state, { name: 'read_repo_file', input: {} }).allowed, true);
  assert.equal(registerReasoningToolCall(state, { name: 'read_repo_file', input: { path: 'README.md' } }).allowed, false);
  assert.equal(state.status, 'waiting');
  assert.equal(registerModelStep(state).allowed, false);
});
