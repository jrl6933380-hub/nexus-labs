import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReasoningState,
  formatReasoningState,
  recordReasoningToolResult,
  registerModelStep,
  registerReasoningToolCall,
  registerToolSearch,
  nativeServerToolLimits,
  registerNativeServerToolCalls,
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

test('tool search rejects a category that is already loaded', () => {
  const state = createReasoningState({ message: 'Build it.', runState: { loadedCapabilities: ['coding'] } });
  const result = registerToolSearch(state, 'coding', ['coding']);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'capability_already_loaded');
  assert.equal(state.searchedCapabilities.size, 0);
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

test('a latest failed action cannot be overwritten by earlier verified evidence', () => {
  const state = createReasoningState({ message: 'Fix it.' });
  const call = { name: 'run_sandbox', input: { command: 'npm test' } };
  recordReasoningToolResult(state, call, { is_error: true, content: 'tests failed' });
  finalizeReasoningState(state, { status: 'verified', missing: [] });
  assert.equal(state.status, 'waiting');
  assert.equal(state.blocker, 'latest_tool_failed');
});

test('resumed runs keep counters, elapsed time, and blocked fingerprints', () => {
  const state = createReasoningState({
    message: 'Resume it.',
    now: 50_000,
    runState: {
      resumed: true,
      state: 'blocked',
      blocker: 'repeated_failure:run_sandbox',
      toolCalls: 7,
      modelSteps: 3,
      completionReplans: 1,
      failureCounts: [['failure-key', 2]],
      blockedToolCalls: ['blocked-key'],
      startedAt: 10_000,
    },
  });
  assert.equal(state.status, 'blocked');
  assert.equal(state.toolCalls, 7);
  assert.equal(state.modelSteps, 3);
  assert.equal(state.completionReplans, 1);
  assert.equal(state.failureCounts.get('failure-key'), 2);
  assert.equal(state.blockedToolCalls.has('blocked-key'), true);
  assert.equal(state.startedAt, 10_000);
});

test('native provider web tools are capped by and counted against the tool budget', () => {
  const state = createReasoningState({ message: 'Research it.', budgets: { maxToolCalls: 3 } });
  assert.deepEqual(nativeServerToolLimits(state), { webSearch: 2, webFetch: 1 });
  const result = registerNativeServerToolCalls(state, [
    { type: 'server_tool_use', name: 'web_search', input: { query: 'one' } },
    { type: 'text', text: 'ignored' },
    { type: 'server_tool_use', name: 'web_fetch', input: { url: 'https://example.com' } },
  ]);
  assert.deepEqual(result, { allowed: true, counted: 2 });
  assert.equal(state.toolCalls, 2);
  assert.deepEqual(nativeServerToolLimits(state), { webSearch: 1, webFetch: 0 });
});

test('budget exhaustion pauses both model and tool execution until resume', () => {
  const state = createReasoningState({ message: 'Keep going.', budgets: { maxToolCalls: 1 } });
  assert.equal(registerReasoningToolCall(state, { name: 'read_repo_file', input: {} }).allowed, true);
  assert.equal(registerReasoningToolCall(state, { name: 'read_repo_file', input: { path: 'README.md' } }).allowed, false);
  assert.equal(state.status, 'waiting');
  assert.equal(registerModelStep(state).allowed, false);
});
