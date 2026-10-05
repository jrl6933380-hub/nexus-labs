import { createHash, randomUUID } from 'node:crypto';
import { checkpointExecution, getExecutionResume } from './executionLedger.js';

const RUN_ID = /^nex-turn-[a-zA-Z0-9-]{8,80}$/u;
const CHECKPOINT_TOOLS = new Set([
  'tool_search',
  'create_branch', 'create_repo_file', 'update_repo_file', 'patch_repo_file', 'delete_repo_file',
  'commit_repo_files', 'run_sandbox', 'test_code', 'inspect_branch_diff', 'create_pull_request',
]);

function perceptionDigest(clientContext = {}) {
  const screen = clientContext.screen || {};
  const safe = JSON.stringify({
    active_view: clientContext.active_view || null,
    title: screen.title || null,
    viewport_text: Array.isArray(screen.viewport_text) ? screen.viewport_text.slice(0, 30) : [],
    controls: Array.isArray(screen.controls) ? screen.controls.slice(0, 40) : [],
    focused: screen.focused || null,
  });
  return createHash('sha256').update(safe).digest('hex').slice(0, 20);
}

function scopeDigest(scopeId) {
  return scopeId ? createHash('sha256').update(`nex-run-scope:${scopeId}`).digest('hex').slice(0, 24) : null;
}

export function createNexRunState({ resumeRunId = null, clientContext = {}, previous = null, scopeId = null } = {}) {
  const scopeHash = scopeDigest(scopeId);
  const resumed = Boolean(scopeHash) && RUN_ID.test(String(resumeRunId || '')) && previous?.run_id === resumeRunId && previous?.scope_hash === scopeHash;
  return {
    runId: resumed ? resumeRunId : `nex-turn-${randomUUID()}`,
    resumed,
    scopeHash,
    state: resumed ? previous.state || 'running' : 'running',
    perceptionDigest: perceptionDigest(clientContext),
    previousPerceptionDigest: previous?.perception_digest || null,
    lastCompletedTool: previous?.last_completed_tool || null,
    lastResult: previous?.last_result || '',
    nextSafeAction: previous?.next_safe_action || 'Inspect current state before the first mutation.',
    workingBranch: previous?.working_branch || null,
    filesTouched: Array.isArray(previous?.files_touched) ? [...previous.files_touched] : [],
    blocker: previous?.blocker || null,
    goal: previous?.goal || '',
    currentStep: previous?.current_step || previous?.next_safe_action || 'Inspect current state before the first mutation.',
    acceptanceConditions: Array.isArray(previous?.acceptance_conditions) ? [...previous.acceptance_conditions] : [],
    knownFacts: Array.isArray(previous?.known_facts) ? [...previous.known_facts] : [],
    loadedCapabilities: Array.isArray(previous?.loaded_capabilities) ? [...previous.loaded_capabilities] : [],
    searchedCapabilities: Array.isArray(previous?.searched_capabilities) ? [...previous.searched_capabilities] : [],
    missingEvidence: Array.isArray(previous?.missing_evidence) ? [...previous.missing_evidence] : [],
    toolCalls: Math.max(0, Number(previous?.tool_calls) || 0),
    modelSteps: Math.max(0, Number(previous?.model_steps) || 0),
    completionReplans: Math.max(0, Number(previous?.completion_replans) || 0),
    failureCounts: Array.isArray(previous?.failure_counts) ? previous.failure_counts : [],
    blockedToolCalls: Array.isArray(previous?.blocked_tool_calls) ? previous.blocked_tool_calls : [],
    startedAt: Number(previous?.reasoning_started_at) || null,
    lastActionFailed: Boolean(previous?.last_action_failed),
  };
}

export async function loadNexRunState({ resumeRunId = null, clientContext = {}, scopeId = null } = {}, deps = {}) {
  const read = deps.getExecutionResume || getExecutionResume;
  let previous = null;
  if (scopeId && RUN_ID.test(String(resumeRunId || ''))) {
    try { previous = await read(resumeRunId); } catch (error) { console.error('Nex resume lookup failed:', error.message); }
  }
  return createNexRunState({ resumeRunId, clientContext, previous, scopeId });
}

export function advanceNexRunState(state, block, result) {
  const next = { ...state, filesTouched: [...state.filesTouched] };
  const failed = result?.is_error === true;
  next.state = failed ? 'blocked' : 'running';
  next.blocker = failed ? `TOOL_FAILED:${block?.name || 'unknown'}` : null;
  if (!failed) next.lastCompletedTool = block?.name || null;
  next.lastResult = String(result?.content || '').replace(/\s+/gu, ' ').trim().slice(0, 500);
  next.nextSafeAction = failed
    ? 'Inspect the failed tool result and current target state before retrying.'
    : `Continue after ${block?.name || 'the completed step'}; re-check mutable state before the next write.`;
  if (block?.input?.branch) next.workingBranch = block.input.branch;
  if (block?.input?.path && !next.filesTouched.includes(block.input.path)) next.filesTouched.push(block.input.path);
  next.filesTouched = next.filesTouched.slice(-30);
  return next;
}

export function shouldCheckpointNexRun(block, result) {
  return result?.is_error === true || CHECKPOINT_TOOLS.has(block?.name);
}

export async function persistNexRunState(state, deps = {}) {
  const write = deps.checkpointExecution || checkpointExecution;
  return write({
    run_id: state.runId,
    agent: 'nex',
    state: state.state,
    last_completed_tool: state.lastCompletedTool,
    last_result: state.lastResult,
    next_safe_action: state.nextSafeAction,
    working_branch: state.workingBranch,
    files_touched: state.filesTouched,
    blocker: state.blocker,
    perception_digest: state.perceptionDigest,
    scope_hash: state.scopeHash,
    goal: state.goal,
    current_step: state.currentStep,
    acceptance_conditions: state.acceptanceConditions,
    known_facts: state.knownFacts,
    loaded_capabilities: state.loadedCapabilities,
    searched_capabilities: state.searchedCapabilities,
    missing_evidence: state.missingEvidence,
    tool_calls: state.toolCalls,
    model_steps: state.modelSteps,
    completion_replans: state.completionReplans,
    failure_counts: state.failureCounts,
    blocked_tool_calls: state.blockedToolCalls,
    reasoning_started_at: state.startedAt,
    last_action_failed: state.lastActionFailed,
    record_event: deps.recordEvent !== false,
  });
}

export function publicRunState(state) {
  return {
    runId: state.runId,
    resumed: state.resumed,
    state: state.state,
    perceptionChanged: Boolean(state.previousPerceptionDigest && state.previousPerceptionDigest !== state.perceptionDigest),
    lastCompletedTool: state.lastCompletedTool,
    nextSafeAction: state.nextSafeAction,
    workingBranch: state.workingBranch,
    filesTouched: [...state.filesTouched],
    blocker: state.blocker,
    goal: state.goal,
    currentStep: state.currentStep,
    acceptanceConditions: [...(state.acceptanceConditions || [])],
    loadedCapabilities: [...(state.loadedCapabilities || [])],
    searchedCapabilities: [...(state.searchedCapabilities || [])],
    missingEvidence: [...(state.missingEvidence || [])],
  };
}
