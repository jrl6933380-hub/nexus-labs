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
