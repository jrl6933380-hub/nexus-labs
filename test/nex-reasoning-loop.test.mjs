import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReasoningState,
  canReplanCompletion,
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

test('an empty query can inspect the directory once and still consumes the search budget', () => {
  const state = createReasoningState({ message: 'Find the right capability.', budgets: { maxToolSearches: 2 } });
  assert.equal(registerToolSearch(state, '').allowed, true);
  assert.equal(registerToolSearch(state, '  ').reason, 'duplicate_tool_search');
  assert.equal(registerToolSearch(state, 'coding', ['coding']).allowed, true);
  assert.equal(registerToolSearch(state, 'billing').reason, 'tool_search_budget_exhausted');
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

test('stall detection compares real outcomes while changing poll results remain useful',()=>{
 const state=createReasoningState({message:'Check progress',budgets:{continueUntilDone:true,maxNoProgressSteps:2}}),call={name:'read_workbench_project',input:{project_id:'workout'}};
 for(const content of ['version 1','version 2','version 3']){assert.equal(registerReasoningToolCall(state,call).allowed,true);assert.equal(recordReasoningToolResult(state,call,{content}).blocked,false);}
 assert.equal(recordReasoningToolResult(state,call,{content:'version 3'}).blocked,false);
 assert.equal(recordReasoningToolResult(state,call,{content:'version 3'}).stalled,true);assert.equal(state.blocker,'no_progress_stall_detected');
});

test('long useful work checkpoints before the serverless request times out', () => {
  const state = createReasoningState({ message: 'Do a long real task.' });
  for (let i = 0; i < 24; i++) {
    const call = { name: 'read_repo_file', input: { path: `lib/file-${i}.js` } };
    assert.equal(registerModelStep(state).allowed, true);
    assert.equal(registerReasoningToolCall(state, call).allowed, true);
    recordReasoningToolResult(state, call, { is_error: false, content: 'ok' });
  }
  assert.equal(registerModelStep(state).allowed, false);
  assert.equal(state.status, 'waiting');
  assert.equal(state.blocker, 'runaway_safety_ceiling_hit');
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


test('continuing builders repair failed saves without the old step, tool, search, or replan caps',()=>{
  const state=createReasoningState({message:'Build the workout page',now:1000,budgets:{continueUntilPreview:true,maxElapsedMs:240000}});
  const bad={name:'save_workbench_project',input:{project_id:'Body weight 1',html:'<html>draft</html>'}};
  for(let i=0;i<2;i++){
    assert.equal(registerReasoningToolCall(state,bad,1000).allowed,true);
    assert.equal(recordReasoningToolResult(state,bad,{is_error:true,content:'Fix project_id: no spaces'}).blocked,false);
  }
  assert.equal(state.status,'running');assert.equal(registerReasoningToolCall(state,bad,1000).allowed,false);
  const fixed={...bad,input:{...bad.input,project_id:'bodyweight-1'}};
  assert.equal(registerReasoningToolCall(state,fixed,1000).allowed,true);
  recordReasoningToolResult(state,fixed,{content:'Saved build b1'});
  for(let i=0;i<100;i++){
    assert.equal(registerModelStep(state,1000).allowed,true);
    assert.equal(registerReasoningToolCall(state,{name:'read_workbench_project',input:{project_id:'project-'+i}},1000).allowed,true);
    assert.equal(registerToolSearch(state,'capability-'+i).allowed,true);
    assert.equal(canReplanCompletion(state),true);
  }
  assert.equal(registerModelStep(state,241000).allowed,false);
  assert.equal(state.status,'waiting');assert.match(state.currentStep,/continue in the next execution window/);
});

test('continuing builders resume an old blocked checkpoint but still pause for access',()=>{
  const state=createReasoningState({message:'Repair saved workout',runState:{state:'blocked',blocker:'repeated_failure:save_workbench_project',toolCalls:90},budgets:{continueUntilPreview:true}});
  assert.equal(state.status,'planning');assert.equal(registerModelStep(state).allowed,true);
  const call={name:'save_workbench_project',input:{project_id:'workout'}};
  recordReasoningToolResult(state,call,{is_error:true,needs_user_input:true,content:'Please sign in again'});
  assert.equal(state.status,'blocked');assert.equal(state.blocker,'needs_user_input:save_workbench_project');
});


test('unchanged pending external operations yield a checkpoint rather than a failed assignment',()=>{
 const state=createReasoningState({message:'Wait for build',budgets:{continueUntilDone:true,maxNoProgressSteps:2}}),call={name:'get_workflow_status',input:{run_id:'one'}},result={content:'{"status":"running"}'};
 for(let i=0;i<3;i++)recordReasoningToolResult(state,call,result);
 assert.equal(state.status,'waiting');assert.equal(state.blocker,'external_work_pending');assert.equal(registerModelStep(state).allowed,false);
});
