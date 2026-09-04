// /lib/executionLedger.js
// Durable, bounded, secret-safe execution history for agent/tool runs.
// This module deliberately stores metadata and summaries, never raw tool output.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const EVENTS_KEY = 'nexus:ledger:events';
const POINTERS_KEY = 'nexus:ledger:pointers';
const EVENT_LIMIT = 200;
const SUMMARY_LIMIT = 500;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out']);

const SECRET_KEY = /(authorization|token|secret|password|cookie|private[_-]?key|api[_-]?key)/i;
const SECRET_VALUE = /(bearer\s+|sk-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]|-----BEGIN)/i;

function clean(value, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) return '[redacted]';
    return value.length > SUMMARY_LIMIT ? value.slice(0, SUMMARY_LIMIT) + '…' : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => clean(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [
      key, SECRET_KEY.test(key) ? '[redacted]' : clean(item, depth + 1),
    ]));
  }
  return value ?? null;
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Ledger Redis command ${command[0]} failed`);
  return data.result;
}

function id(prefix = 'run') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`);
  return value.trim();
}

async function storeEvent(event) {
  const safeEvent = clean(event);
  await Promise.all([
    redisCommand(['LPUSH', EVENTS_KEY, JSON.stringify(safeEvent)]),
    redisCommand(['LTRIM', EVENTS_KEY, '0', String(EVENT_LIMIT - 1)]),
  ]);
  return safeEvent;
}

export async function startExecution({ task_id = null, agent, tool, purpose, target = null, branch = null, approval = 'not_required', run_id = null }) {
  const runId = run_id ? requireText(run_id, 'run_id') : id();
  agent = requireText(agent, 'agent');
  tool = requireText(tool, 'tool');
  purpose = requireText(purpose, 'purpose');
  const event = {
    event_id: id('event'), run_id: runId, sequence: Date.now(),
    type: 'tool_started', task_id, agent, tool, purpose, target, branch, approval,
    status: 'started', at: Date.now(),
  };
  return { run_id: runId, event: await storeEvent(event) };
}

export async function finishExecution({ run_id, task_id = null, agent, tool, status = 'completed', result_summary = '', artifact_refs = [], next_action, error_code = null, may_have_written = false }) {
  run_id = requireText(run_id, 'run_id');
  agent = requireText(agent, 'agent');
  tool = requireText(tool, 'tool');
  if (!TERMINAL_STATUSES.has(status)) throw new Error(`Invalid terminal status: ${status}`);
  const needsVerification = status !== 'completed' && may_have_written;
  const safeNextAction = needsVerification
    ? 'Re-read the target and compare its current SHA/state before retrying.'
    : (next_action || null);
  const event = {
    event_id: id('event'), run_id, sequence: Date.now(), type: status === 'completed' ? 'tool_completed' : 'tool_failed',
    task_id, agent, tool, status, result_summary, artifact_refs, error_code, may_have_written,
    next_action: safeNextAction, at: Date.now(),
  };
  const pointer = clean({
    run_id,
    task_id,
    agent,
    state: status === 'completed' ? 'running' : 'blocked',
    last_sequence: event.sequence,
    last_completed_tool: status === 'completed' ? tool : null,
    last_result: result_summary,
    next_safe_action: safeNextAction,
    blocker: status === 'completed' ? null : (error_code || status),
    updated_at: event.at,
  });
  const [safeEvent] = await Promise.all([
    storeEvent(event),
    redisCommand(['HSET', POINTERS_KEY, run_id, JSON.stringify(pointer)]),
  ]);
  return safeEvent;
}

export async function checkpointExecution({ run_id, task_id = null, agent, state = 'paused', last_completed_tool = null, last_result = '', next_safe_action, working_branch = null, files_touched = [], blocker = null }) {
  run_id = requireText(run_id, 'run_id');
  agent = requireText(agent, 'agent');
  next_safe_action = requireText(next_safe_action, 'next_safe_action');
  const pointer = clean({
    run_id, task_id, agent, state, last_sequence: Date.now(), last_completed_tool,
    last_result, next_safe_action, working_branch, files_touched, blocker, updated_at: Date.now(),
  });
  await Promise.all([
    redisCommand(['HSET', POINTERS_KEY, run_id, JSON.stringify(pointer)]),
    storeEvent({ ...pointer, type: 'checkpoint', event_id: id('event') }),
  ]);
  return pointer;
}

export async function getExecutionResume(run_id) {
  run_id = requireText(run_id, 'run_id');
  const raw = await redisCommand(['HGET', POINTERS_KEY, run_id]);
  return raw ? JSON.parse(raw) : null;
}

export async function listExecutionEvents(run_id = null, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, EVENT_LIMIT));
  const raw = await redisCommand(['LRANGE', EVENTS_KEY, '0', String(safeLimit - 1)]);
  return (raw || []).map((item) => { try { return JSON.parse(item); } catch { return null; } })
    .filter((event) => event && (!run_id || event.run_id === run_id));
}
