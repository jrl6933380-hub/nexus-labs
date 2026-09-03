// /lib/executionLedger.js
// Durable, bounded, secret-safe execution history for agent/tool runs.
// This module deliberately stores metadata and summaries, never raw tool output.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const EVENTS_KEY = 'nexus:ledger:events';
const POINTERS_KEY = 'nexus:ledger:pointers';
const EVENT_LIMIT = 200;
const SUMMARY_LIMIT = 500;

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

export async function startExecution({ task_id = null, agent, tool, purpose, target = null, branch = null, approval = 'not_required', run_id = null }) {
  const runId = run_id || id();
  const event = {
    event_id: id('event'), run_id: runId, sequence: Date.now(),
    type: 'tool_started', task_id, agent, tool, purpose, target, branch, approval,
    status: 'started', at: Date.now(),
  };
  await redisCommand(['LPUSH', EVENTS_KEY, JSON.stringify(clean(event))]);
  await redisCommand(['LTRIM', EVENTS_KEY, '0', String(EVENT_LIMIT - 1)]);
  return { run_id: runId, event: clean(event) };
}

export async function finishExecution({ run_id, task_id = null, agent, tool, status = 'completed', result_summary = '', artifact_refs = [], next_action, error_code = null, may_have_written = false }) {
  const event = {
    event_id: id('event'), run_id, sequence: Date.now(), type: status === 'failed' ? 'tool_failed' : 'tool_completed',
    task_id, agent, tool, status, result_summary, artifact_refs, error_code, may_have_written, next_action, at: Date.now(),
  };
  await redisCommand(['LPUSH', EVENTS_KEY, JSON.stringify(clean(event))]);
  await redisCommand(['LTRIM', EVENTS_KEY, '0', String(EVENT_LIMIT - 1)]);
  return clean(event);
}

export async function checkpointExecution({ run_id, task_id = null, agent, state = 'paused', last_completed_tool = null, last_result = '', next_safe_action, working_branch = null, files_touched = [], blocker = null }) {
  const pointer = clean({
    run_id, task_id, agent, state, last_sequence: Date.now(), last_completed_tool,
    last_result, next_safe_action, working_branch, files_touched, blocker, updated_at: Date.now(),
  });
  await redisCommand(['HSET', POINTERS_KEY, run_id, JSON.stringify(pointer)]);
  await redisCommand(['LPUSH', EVENTS_KEY, JSON.stringify({ ...pointer, type: 'checkpoint', event_id: id('event') })]);
  await redisCommand(['LTRIM', EVENTS_KEY, '0', String(EVENT_LIMIT - 1)]);
  return pointer;
}

export async function getExecutionResume(run_id) {
  const raw = await redisCommand(['HGET', POINTERS_KEY, run_id]);
  return raw ? JSON.parse(raw) : null;
}

export async function listExecutionEvents(run_id = null, limit = 50) {
  const raw = await redisCommand(['LRANGE', EVENTS_KEY, '0', String(Math.min(limit, EVENT_LIMIT) - 1)]);
  return (raw || []).map((item) => { try { return JSON.parse(item); } catch { return null; } })
    .filter((event) => event && (!run_id || event.run_id === run_id));
}
