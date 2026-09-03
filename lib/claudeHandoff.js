import { createTask, updateProgress, markBlocked } from './board.js';
import { fireClaudeRoutine, createRedisWakeLedger } from './routineWake.js';

const DISENGAGE_PATTERN = /^nex[,:\s-]+disengage[.!]?$/i;
const ENGAGE_PATTERN = /^nex[,:\s-]+(?:re-?engage|engage)[.!]?$/i;

export function isDisengageCommand(message) {
  return typeof message === 'string' && DISENGAGE_PATTERN.test(message.trim());
}

export function isEngageCommand(message) {
  return typeof message === 'string' && ENGAGE_PATTERN.test(message.trim());
}

export async function startClaudeHandoff(dependencies = {}) {
  const createTaskFn = dependencies.createTaskFn || createTask;
  const updateProgressFn = dependencies.updateProgressFn || updateProgress;
  const markBlockedFn = dependencies.markBlockedFn || markBlocked;
  const fireRoutineFn = dependencies.fireRoutineFn || fireClaudeRoutine;
  const ledger = dependencies.ledger || createRedisWakeLedger();

  const task = await createTaskFn({
    title: 'Direct Claude takeover',
    owner: 'claude-routine',
    description:
      'NEX DISENGAGE HANDOFF — Justin asked for a direct Claude working session. ' +
      'Before responding or doing work, read the entire shared Agent Board and BRIDGE.md in ' +
      'jrl6933380-hub/nexus-labs, then skim agent-lessons/. You are Claude in this session, ' +
      'not Nex and not a Nex roleplay. Give Justin a short confirmation that you are caught up, ' +
      'then wait for his instructions in the Claude session. Do not edit files, merge, deploy, ' +
      'use credentials, or spend money merely because this handoff task exists; Justin must ' +
      'authorize any actual work in that Claude session.',
  });

  const envelope = {
    task_id: task.id,
    trace_id: `claude-handoff-${task.id}`,
    idempotency_key: `claude-handoff-${task.id}`,
  };

  try {
    const wake = await fireRoutineFn(envelope, { ledger });
    await updateProgressFn({
      id: task.id,
      status: 'building',
      note: `Claude takeover session started: ${wake.session_url}`,
    });
    return { task, wake };
  } catch (error) {
    await markBlockedFn({
      id: task.id,
      reason: `Claude takeover wake failed: ${error.message}`,
    });
    throw error;
  }
}

// General-purpose version of the above, for Nex's own wake_claude_code
// tool (lib/nexBrain.js) — same create-task/fire/update-or-block
// pattern, but with a caller-supplied title/description instead of the
// fixed "Direct Claude takeover" handoff text, so Nex can actually
// describe what the woken Claude session needs to pick up (e.g.
// finishing a specific test he and Justin/ChatGPT were mid-way
// through) rather than a generic "come take over" message.
export async function wakeClaudeForTask({ title, description }, dependencies = {}) {
  const createTaskFn = dependencies.createTaskFn || createTask;
  const updateProgressFn = dependencies.updateProgressFn || updateProgress;
  const markBlockedFn = dependencies.markBlockedFn || markBlocked;
  const fireRoutineFn = dependencies.fireRoutineFn || fireClaudeRoutine;
  const ledger = dependencies.ledger || createRedisWakeLedger();

  const task = await createTaskFn({
    title: title || 'Nex-requested Claude wake',
    owner: 'claude-routine',
    description:
      `NEX-INITIATED WAKE — ${description}\n\n` +
      'Before responding or doing work, read this task via the Nexus MCP connector, then the ' +
      'rest of the shared Agent Board and BRIDGE.md in jrl6933380-hub/nexus-labs for context. ' +
      'You are Claude in this session, not Nex and not a Nex roleplay. Confirm you understand ' +
      'what needs finishing, then do the work — same branch/PR/approval discipline as every ' +
      'other change on this board; nothing here authorizes writing to main or merging without ' +
      "Justin's explicit go-ahead.",
  });

  const envelope = {
    task_id: task.id,
    trace_id: `nex-wake-${task.id}`,
    idempotency_key: `nex-wake-${task.id}`,
  };

  try {
    const wake = await fireRoutineFn(envelope, { ledger });
    await updateProgressFn({
      id: task.id,
      status: 'building',
      note: `Nex woke Claude for this task: ${wake.session_url}`,
    });
    return { task, wake };
  } catch (error) {
    await markBlockedFn({
      id: task.id,
      reason: `Nex's wake attempt failed: ${error.message}`,
    });
    throw error;
  }
}
