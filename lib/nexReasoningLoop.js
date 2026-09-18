import { createHash } from 'node:crypto';

// Step/call/time counters below are now a runaway-cost circuit breaker, not
// the normal stop condition. Normal stops are real stuck-loop detection:
// repeated identical failures (maxRepeatedFailures) or repeating the exact
// same tool call with no new result (maxNoProgressSteps). The numbers here
// are intentionally huge -- a legitimate task should never reach them; if
// one does, something is genuinely runaway and must stop regardless.
const DEFAULT_BUDGETS = Object.freeze({
  maxModelSteps: 400,
  maxToolCalls: 1000,
  maxToolSearches: 50,
  maxRepeatedFailures: 2,
  maxNoProgressSteps: 8,
  maxCompletionReplans: 2,
  maxElapsedMs: 1_800_000,
});

const TERMINAL = new Set(['completed', 'blocked', 'failed', 'cancelled']);
const STOPPED = new Set([...TERMINAL, 'waiting']);

function boundedInt(value, fallback, min = 1, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(Math.floor(number), max)) : fallback;
}

function normalizeBudgets(input = {}) {
  return Object.freeze({
    maxModelSteps: boundedInt(input.maxModelSteps, DEFAULT_BUDGETS.maxModelSteps, 2, 2000),
    maxToolCalls: boundedInt(input.maxToolCalls, DEFAULT_BUDGETS.maxToolCalls, 1, 5000),
    maxToolSearches: boundedInt(input.maxToolSearches, DEFAULT_BUDGETS.maxToolSearches, 1, 200),
    maxRepeatedFailures: boundedInt(input.maxRepeatedFailures, DEFAULT_BUDGETS.maxRepeatedFailures, 1, 5),
    maxNoProgressSteps: boundedInt(input.maxNoProgressSteps, DEFAULT_BUDGETS.maxNoProgressSteps, 2, 30),
    maxCompletionReplans: boundedInt(input.maxCompletionReplans, DEFAULT_BUDGETS.maxCompletionReplans, 0, 5),
    maxElapsedMs: boundedInt(input.maxElapsedMs, DEFAULT_BUDGETS.maxElapsedMs, 5_000, 3_600_000),
  });
}

function cleanText(value, limit = 1200) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function stableValue(value, depth = 0) {
  if (depth > 8) return '[depth-limit]';
  if (Array.isArray(value)) return value.map((item) => stableValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key], depth + 1)]),
    );
  }
  return value;
}

function normalizedInput(input) {
  if (!input || typeof input !== 'object') return '{}';
  return JSON.stringify(stableValue(input));
}

function toolFingerprint(block) {
  return createHash('sha256')
    .update(`${String(block?.name || 'unknown')}:${normalizedInput(block?.input)}`)
    .digest('hex')
    .slice(0, 20);
}

function failureFingerprint(block, result) {
  const error = cleanText(result?.content, 320)
    .toLowerCase()
    .replace(/[a-f0-9]{16,}/gu, '<id>')
    .replace(/\d{3,}/gu, '<n>');
  return `${toolFingerprint(block)}:${error}`;
}

function acceptanceConditions(plan = {}) {
  const required = Array.isArray(plan.requireEvidence) ? plan.requireEvidence.filter(Boolean) : [];
  return required.length ? [...new Set(required)] : ['substantive_result'];
}

export function createReasoningState({ message, plan = {}, runState = {}, budgets = {}, now = Date.now() } = {}) {
  const previousSearches = Array.isArray(runState.searchedCapabilities) ? runState.searchedCapabilities : [];
  const previousCapabilities = Array.isArray(runState.loadedCapabilities) ? runState.loadedCapabilities : [];
  const totalToolCalls = Math.max(0, Number(runState.toolCalls) || 0);
  const totalModelSteps = Math.max(0, Number(runState.modelSteps) || 0);
  const totalCompletionReplans = Math.max(0, Number(runState.completionReplans) || 0);
  return {
    version: 1,
    goal: cleanText(runState.goal || message, 1800),
    currentStep: cleanText(runState.currentStep || runState.nextSafeAction || 'Understand the request and choose the next safe action.', 500),
    acceptanceConditions: Array.isArray(runState.acceptanceConditions) && runState.acceptanceConditions.length
      ? [...new Set(runState.acceptanceConditions)]
      : acceptanceConditions(plan),
    knownFacts: Array.isArray(runState.knownFacts) ? runState.knownFacts.slice(-12) : [],
    loadedCapabilities: new Set(previousCapabilities),
    searchedCapabilities: new Set(previousSearches.map((item) => cleanText(item, 160).toLowerCase()).filter(Boolean)),
    // Budgets are a bounded allowance for this request. Persisted values are
    // cumulative accounting from earlier slices of the same run, not spent
    // allowance to carry forward. A resumed run keeps its work and safety
    // history while receiving a fresh, bounded execution window.
    toolCalls: 0,
    modelSteps: 0,
    toolSearches: 0,
    completionReplans: 0,
    totalToolCalls,
    totalModelSteps,
    totalCompletionReplans,
    failureCounts: new Map(Array.isArray(runState.failureCounts) ? runState.failureCounts : []),
    blockedToolCalls: new Set(Array.isArray(runState.blockedToolCalls) ? runState.blockedToolCalls : []),
    lastResult: cleanText(runState.lastResult, 500),
    nextCapabilityNeeded: null,
    missingEvidence: [],
    status: runState.state === 'blocked' ? 'blocked' : 'planning',
    blocker: runState.state === 'blocked' ? (runState.blocker || 'run_blocked') : null,
    resumed: Boolean(runState.resumed),
    workingBranch: runState.workingBranch || null,
    filesTouched: Array.isArray(runState.filesTouched) ? runState.filesTouched.slice(-30) : [],
    startedAt: now,
    lastActionFailed: Boolean(runState.lastActionFailed),
    budgets: normalizeBudgets(budgets),
    // Stall-detection state: tracks exact repeated tool calls with no new
    // fingerprint, independent of the runaway-safety counters above.
    noProgressStreak: 0,
    seenFingerprints: new Set(),
  };
}

function elapsedExceeded(state, now = Date.now()) {
  return now - state.startedAt >= state.budgets.maxElapsedMs;
}

export function registerModelStep(state, now = Date.now()) {
  if (STOPPED.has(state.status)) return { allowed: false, reason: state.blocker || `run_${state.status}` };
  if (elapsedExceeded(state, now)) {
    state.status = 'waiting';
    state.blocker = 'runaway_safety_ceiling_hit';
    state.currentStep = 'Stop -- this run has run far longer than any legitimate task should. Report the real blocker.';
    return { allowed: false, reason: state.blocker };
  }
  if (state.modelSteps >= state.budgets.maxModelSteps) {
    state.status = 'waiting';
    state.blocker = 'runaway_safety_ceiling_hit';
    state.currentStep = 'Stop -- this run has taken far more steps than any legitimate task should. Report the real blocker.';
    return { allowed: false, reason: state.blocker };
  }
  state.modelSteps += 1;
  state.totalModelSteps += 1;
  if (state.status === 'planning') state.status = 'running';
  return { allowed: true };
}

export function registerToolSearch(state, query, resolvedCategories = []) {
  const normalized = cleanText(query, 160).toLowerCase();
  if (!normalized) return { allowed: false, reason: 'tool_search_requires_query' };
  const categories = Array.isArray(resolvedCategories) ? resolvedCategories.filter(Boolean) : [];
  if (categories.length && categories.every((category) => state.loadedCapabilities.has(category))) {
    return { allowed: false, reason: 'capability_already_loaded' };
  }
  if (state.searchedCapabilities.has(normalized)) {
    return { allowed: false, reason: 'duplicate_tool_search' };
  }
  if (state.toolSearches >= state.budgets.maxToolSearches) {
    state.status = 'waiting';
    state.blocker = 'tool_search_budget_exhausted';
    return { allowed: false, reason: state.blocker };
  }
  state.toolSearches += 1;
  state.searchedCapabilities.add(normalized);
  state.nextCapabilityNeeded = normalized;
  return { allowed: true };
}

export function registerReasoningToolCall(state, block, now = Date.now()) {
  if (STOPPED.has(state.status)) return { allowed: false, reason: state.blocker || `run_${state.status}` };
  if (elapsedExceeded(state, now)) {
    state.status = 'waiting';
    state.blocker = 'runaway_safety_ceiling_hit';
    state.currentStep = 'Stop -- this run has run far longer than any legitimate task should. Report the real blocker.';
    return { allowed: false, reason: state.blocker };
  }
  const fingerprint = toolFingerprint(block);
  if (state.blockedToolCalls.has(fingerprint)) {
    return { allowed: false, reason: 'repeated_tool_failure_blocked' };
  }
  if (state.toolCalls >= state.budgets.maxToolCalls) {
    state.status = 'waiting';
    state.blocker = 'runaway_safety_ceiling_hit';
    state.currentStep = 'Stop -- this run has made far more tool calls than any legitimate task should. Report the real blocker.';
    return { allowed: false, reason: state.blocker };
  }
  if (state.seenFingerprints.has(fingerprint)) {
    state.noProgressStreak += 1;
    if (state.noProgressStreak >= state.budgets.maxNoProgressSteps) {
      state.status = 'blocked';
      state.blocker = 'no_progress_stall_detected';
      state.currentStep = 'Stop repeating the exact same action with no new result -- inspect why nothing is advancing and change the plan.';
      return { allowed: false, reason: state.blocker };
    }
  } else {
    state.seenFingerprints.add(fingerprint);
    state.noProgressStreak = 0;
  }
  state.toolCalls += 1;
  state.totalToolCalls += 1;
  state.currentStep = `Execute ${String(block?.name || 'the selected tool')} and inspect the real result.`;
  return { allowed: true, fingerprint };
}

export function recordReasoningToolResult(state, block, result) {
  state.lastResult = cleanText(result?.content, 500);
  if (block?.input?.branch) state.workingBranch = block.input.branch;
  if (block?.input?.path && !state.filesTouched.includes(block.input.path)) {
    state.filesTouched.push(block.input.path);
    state.filesTouched = state.filesTouched.slice(-30);
  }

  if (result?.is_error === true) {
    state.lastActionFailed = true;
    const failure = failureFingerprint(block, result);
    const count = (state.failureCounts.get(failure) || 0) + 1;
    state.failureCounts.set(failure, count);
    if (count >= state.budgets.maxRepeatedFailures) {
      state.blockedToolCalls.add(toolFingerprint(block));
      state.status = 'blocked';
      state.blocker = `repeated_failure:${String(block?.name || 'unknown')}`;
      state.currentStep = 'Stop blind retries, inspect the root cause, and wait for a changed plan or new evidence.';
      return { blocked: true, count };
    }
    state.currentStep = 'Inspect the failed result and change the plan before retrying.';
    return { blocked: false, count };
  }

  state.lastActionFailed = false;
  state.status = 'running';
  state.blocker = null;
  state.currentStep = `Verify the result from ${String(block?.name || 'the completed action')} and choose the next required step.`;
  return { blocked: false, count: 0 };
}

export function canReplanCompletion(state) {
  if (STOPPED.has(state.status)) return false;
  if (state.completionReplans >= state.budgets.maxCompletionReplans) return false;
  state.completionReplans += 1;
  state.totalCompletionReplans += 1;
  state.status = 'verifying';
  return true;
}

export function finalizeReasoningState(state, receipt = {}) {
  const missing = Array.isArray(receipt.missing) ? receipt.missing.filter(Boolean) : [];
  state.missingEvidence = missing;
  // A controller-enforced stop must never be overwritten by an otherwise
  // empty/not-required evidence receipt at the end of the turn.
  const evidenceWait = state.blocker === 'completion_not_verified' || String(state.blocker || '').startsWith('missing_evidence:');
  if (['blocked', 'failed', 'cancelled'].includes(state.status) || (state.status === 'waiting' && state.blocker && !evidenceWait)) {
    return state;
  }
  if (state.lastActionFailed) {
    state.status = 'waiting';
    state.blocker = 'latest_tool_failed';
    state.currentStep = 'Inspect the latest failed action and collect fresh evidence before claiming completion.';
    return state;
  }
  if (receipt.status === 'verified' || receipt.status === 'not_required') {
    state.status = 'completed';
    state.blocker = null;
    state.currentStep = 'Task complete.';
  } else if (state.status !== 'blocked') {
    state.status = 'waiting';
    state.blocker = missing.length ? `missing_evidence:${missing.join(',')}` : 'completion_not_verified';
    state.currentStep = missing.length
      ? `Collect missing evidence: ${missing.join(', ')}.`
      : 'Verify the requested outcome before claiming completion.';
  }
  return state;
}

export function formatReasoningState(state) {
  if (!state) return '';
  return [
    '## Active reasoning state (backend-enforced)',
    `Goal: ${state.goal || '(not set)'}`,
    `Status: ${state.status}`,
    `Current step: ${state.currentStep}`,
    `Acceptance conditions: ${state.acceptanceConditions.join(', ') || 'substantive_result'}`,
    `Loaded capabilities: ${[...state.loadedCapabilities].join(', ') || '(core only)'}`,
    `Already searched: ${[...state.searchedCapabilities].join(', ') || '(none)'}`,
    `Last result: ${state.lastResult || '(none)'}`,
    `Working branch: ${state.workingBranch || '(none)'}`,
    `Files touched: ${state.filesTouched.join(', ') || '(none)'}`,
    `Budget used this request: model steps ${state.modelSteps}/${state.budgets.maxModelSteps}; tool calls ${state.toolCalls}/${state.budgets.maxToolCalls}; searches ${state.toolSearches}/${state.budgets.maxToolSearches}`,
    `Run totals: model steps ${state.totalModelSteps}; tool calls ${state.totalToolCalls}`,
    'Use tool_search only for a capability that is not already loaded. Do not repeat an identical failed action without new evidence or a changed plan.',
  ].join('\n');
}

export function reasoningStateForCheckpoint(state) {
  return {
    goal: state.goal,
    current_step: state.currentStep,
    acceptance_conditions: [...state.acceptanceConditions],
    known_facts: state.knownFacts.slice(-12),
    loaded_capabilities: [...state.loadedCapabilities],
    searched_capabilities: [...state.searchedCapabilities],
    reasoning_status: state.status,
    reasoning_blocker: state.blocker,
    missing_evidence: [...state.missingEvidence],
    tool_calls: state.totalToolCalls,
    model_steps: state.totalModelSteps,
    completion_replans: state.totalCompletionReplans,
    failure_counts: [...state.failureCounts.entries()],
    blocked_tool_calls: [...state.blockedToolCalls],
    reasoning_started_at: state.startedAt,
    last_action_failed: state.lastActionFailed,
  };
}

export function nativeServerToolLimits(state) {
  const remaining = Math.max(0, state.budgets.maxToolCalls - state.toolCalls);
  if (remaining === 0) return { webSearch: 0, webFetch: 0 };
  return {
    webSearch: Math.min(5, Math.ceil(remaining / 2)),
    webFetch: Math.min(5, Math.floor(remaining / 2)),
  };
}

export function registerNativeServerToolCalls(state, blocks = []) {
  let counted = 0;
  for (const block of blocks.filter((item) => item?.type === 'server_tool_use')) {
    const result = registerReasoningToolCall(state, { name: block.name || 'provider_server_tool', input: block.input || {} });
    if (!result.allowed) return { allowed: false, reason: result.reason, counted };
    counted += 1;
  }
  return { allowed: true, counted };
}

export { DEFAULT_BUDGETS };
