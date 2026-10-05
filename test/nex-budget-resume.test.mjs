import test from 'node:test';
import assert from 'node:assert/strict';
import { createNexRunState, loadNexRunState, persistNexRunState } from '../lib/nexRunState.js';
import { createReasoningState, registerModelStep, registerReasoningToolCall, recordReasoningToolResult, reasoningStateForCheckpoint } from '../lib/nexReasoningLoop.js';

async function roundTrip(state, reasoning, now) {
  const c = reasoningStateForCheckpoint(reasoning);
  Object.assign(state, {
    state: reasoning.status, blocker: reasoning.blocker,
    modelSteps: c.model_steps, toolCalls: c.tool_calls,
    completionReplans: c.completion_replans, startedAt: c.reasoning_started_at,
    failureCounts: c.failure_counts, blockedToolCalls: c.blocked_tool_calls,
  });
  let saved;
  await persistNexRunState(state, { checkpointExecution: async value => { saved = value; } });
  const loaded = await loadNexRunState({ resumeRunId: state.runId, scopeId: 'owner' }, {
    getExecutionResume: async () => saved,
  });
  assert.equal(loaded.resumed, true);
  assert.equal(loaded.workingBranch, 'fix/example');
  assert.deepEqual(loaded.filesTouched, ['lib/example.js']);
  return { loaded, reasoning: createReasoningState({ runState: loaded, now, budgets: reasoning.budgets }) };
}

function seed() {
  return { ...createNexRunState({ scopeId: 'owner' }), workingBranch: 'fix/example', filesTouched: ['lib/example.js'] };
}

test('persisted exhausted model budget resumes twice, keeps totals, and re-enforces each window', async () => {
  let run = seed();
  let reasoning = createReasoningState({ runState: run, now: 1000, budgets: { maxModelSteps: 2 } });
  for (let window = 0; window < 3; window++) {
    const now = 1000 + window * 200000;
    assert.equal(registerModelStep(reasoning, now).allowed, true);
    assert.equal(registerModelStep(reasoning, now).allowed, true);
    assert.equal(registerModelStep(reasoning, now).reason, 'runaway_safety_ceiling_hit');
    assert.equal(reasoningStateForCheckpoint(reasoning).model_steps, 2 * (window + 1));
    if (window < 2) {
      const next = await roundTrip(run, reasoning, now + 200000);
      run = next.loaded;
      reasoning = next.reasoning;
    }
  }
});

test('persisted time and tool limits allow a fresh request but still bound it', async () => {
  for (const limit of ['time', 'tools']) {
    const run = seed();
    const state = createReasoningState({ now: 1000, budgets: { maxToolCalls: 1, maxElapsedMs: 5000 } });
    if (limit === 'time') assert.equal(registerModelStep(state, 6000).allowed, false);
    else {
      assert.equal(registerReasoningToolCall(state, { name: 'read' }, 1000).allowed, true);
      assert.equal(registerReasoningToolCall(state, { name: 'read' }, 1000).allowed, false);
    }
    const { reasoning } = await roundTrip(run, state, 200000);
    assert.equal(registerModelStep(reasoning, 200000).allowed, true);
    assert.equal(registerReasoningToolCall(reasoning, { name: 'read' }, 200000).allowed, true);
    assert.equal(registerReasoningToolCall(reasoning, { name: 'read' }, 200000).allowed, false);
  }
});

test('failure history survives a checkpoint and blocks the second identical failure', async () => {
  const run = seed();
  const call = { name: 'read', input: { path: 'missing.js' } };
  const error = { is_error: true, content: 'Not found' };
  const state = createReasoningState({ now: 1000 });
  registerReasoningToolCall(state, call, 1000);
  recordReasoningToolResult(state, call, error);
  state.status = 'waiting';
  const { loaded, reasoning } = await roundTrip(run, state, 200000);
  assert.equal(registerReasoningToolCall(reasoning, call, 200000).allowed, true);
  assert.equal(recordReasoningToolResult(reasoning, call, error).blocked, true);
  const next = await roundTrip(loaded, reasoning, 400000);
  assert.equal(next.reasoning.status, 'blocked');
  assert.equal(registerModelStep(next.reasoning, 400000).allowed, false);
  assert.equal(registerReasoningToolCall(next.reasoning, call, 400000).allowed, false);
});
