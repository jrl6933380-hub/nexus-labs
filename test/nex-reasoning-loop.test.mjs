import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReasoningState,
  formatReasoningState,
  recordReasoningToolResult,
  reasoningStateForCheckpoint,
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

test('resumed runs get a fresh budget window while preserving cumulative progress and safety state', () => {
  const state = createReasoningState({
    message: 'Resume it.',
    now: 50_000,
    budgets: { maxModelSteps: 2, maxToolCalls: 1, maxToolSearches: 1, maxElapsedMs: 5_000 },
    runState: {
      resumed: true,
      state: 'waiting',
      blocker: 'model_step_budget_exhausted',
      toolCalls: 24,
      modelSteps: 12,
      completionReplans: 2,
      searchedCapabilities: ['coding'],
      failureCounts: [['failure-key', 2]],
      blockedToolCalls: ['blocked-key'],
      startedAt: 10_000,
    },
  });

  assert.equal(state.status, 'planning');
  assert.equal(state.blocker, null);
  assert.equal(state.toolCalls, 0);
  assert.equal(state.modelSteps, 0);
  assert.equal(state.toolSearches, 0);
  assert.equal(state.completionReplans, 0);
  assert.equal(state.totalToolCalls, 24);
  assert.equal(state.totalModelSteps, 12);
  assert.equal(state.totalCompletionReplans, 2);
  assert.equal(state.failureCounts.get('failure-key'), 2);
  assert.equal(state.blockedToolCalls.has('blocked-key'), true);
  assert.equal(state.startedAt, 50_000);

  assert.equal(registerModelStep(state, 50_000).allowed, true);
  assert.equal(registerReasoningToolCall(state, { name: 'read_repo_file', input: { path: 'README.md' } }, 50_000).allowed, true);
  assert.equal(registerToolSearch(state, 'coding').reason, 'duplicate_tool_search');
  assert.equal(registerToolSearch(state, 'billing').allowed, true);

  const checkpoint = reasoningStateForCheckpoint(state);
  assert.equal(checkpoint.model_steps, 13);
  assert.equal(checkpoint.tool_calls, 25);
  assert.equal(checkpoint.completion_replans, 2);
  assert.equal(registerToolSearch(state, 'deploy').reason, 'tool_search_budget_exhausted');
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

test('a complex/crew plan gets a materially larger default budget window than simple chat', () => {
  const simpleState = createReasoningState({
    message: 'Quick question.',
    plan: { lane: 'chat', mode: 'direct', complexity: 'simple' },
  });
  const complexState = createReasoningState({
    message: 'Refactor the whole billing pipeline and migrate the schema.',
    plan: { lane: 'code', mode: 'direct', complexity: 'complex' },
  });
  const crewState = createReasoningState({
    message: 'Coordinate a multi-agent build.',
    plan: { lane: 'code', mode: 'crew' },
  });

  assert.ok(complexState.budgets.maxModelSteps > simpleState.budgets.maxModelSteps);
  assert.ok(complexState.budgets.maxToolCalls > simpleState.budgets.maxToolCalls);
  assert.ok(complexState.budgets.maxElapsedMs > simpleState.budgets.maxElapsedMs);
  // crew mode is treated as complex regardless of the reported complexity score
  assert.deepEqual(crewState.budgets.maxModelSteps, complexState.budgets.maxModelSteps);
});

test('an explicit caller-supplied budget field still wins over the plan complexity tier', () => {
  const state = createReasoningState({
    message: 'Deep task but cap tool calls tightly.',
    plan: { lane: 'code', mode: 'direct', complexity: 'complex' },
    budgets: { maxToolCalls: 5 },
  });
  assert.equal(state.budgets.maxToolCalls, 5);
  // untouched fields still pick up the complex tier, not the flat default
  assert.ok(state.budgets.maxModelSteps >= 26);
});
