import { createHash, randomUUID } from 'node:crypto';
import { checkpointExecution, getExecutionResume } from './executionLedger.js';

const RUN_ID = /^nex-turn-[a-zA-Z0-9-]{8,80}$/u;
const CHECKPOINT_TOOLS = new Set([
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

export function createNexRunState({ resumeRunId = null, clientContext = {}, previous = null } = {}) {
  const resumed = RUN_ID.test(String(resumeRunId || '')) && previous?.run_id === resumeRunId;
  return {
    runId: resumed ? resumeRunId : `nex-turn-${randomUUID()}`,
    resumed,
    state: resumed ? previous.state || 'running' : 'running',
    perceptionDigest: perceptionDigest(clientContext),
    previousPerceptionDigest: previous?.perception_digest || null,
    lastCompletedTool: previous?.last_completed_tool || null,
    lastResult: previous?.last_result || '',
    nextSafeAction: previous?.next_safe_action || 'Inspect current state before the first mutation.',
    workingBranch: previous?.working_branch || null,
    filesTouched: Array.isArray(previous?.files_touched) ? [...previous.files_touched] : [],
    blocker: previous?.blocker || null,
  };
}

export async function loadNexRunState({ resumeRunId = null, clientContext = {} } = {}, deps = {}) {
  const read = deps.getExecutionResume || getExecutionResume;
  let previous = null;
  if (RUN_ID.test(String(resumeRunId || ''))) {
    try { previous = await read(resumeRunId); } catch (error) { console.error('Nex resume lookup failed:', error.message); }
  }
  return createNexRunState({ resumeRunId, clientContext, previous });
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
  };
}
