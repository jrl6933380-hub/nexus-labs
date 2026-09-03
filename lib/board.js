// /lib/board.js
// Shared task board plus durable execution telemetry for multi-agent recovery.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TASKS_KEY = 'nexus:board:tasks';
const MESSAGES_KEY = 'nexus:board:messages';
const MESSAGE_LIMIT = 50;
const VALID_STATUSES = ['idle', 'planning', 'building', 'testing', 'blocked', 'waiting_for_justin', 'complete'];

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Redis command ${command[0]} failed`);
  return data.result;
}

export async function listTasks() {
  const raw = await redisCommand(['HGETALL', TASKS_KEY]);
  if (!raw || !Array.isArray(raw)) return [];
  const tasks = [];
  for (let i = 0; i < raw.length; i += 2) { try { tasks.push(JSON.parse(raw[i + 1])); } catch {} }
  tasks.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  return tasks;
}

export async function createTask({ title, description, owner }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = { id, title, description: description || '', status: owner ? 'planning' : 'idle', owner: owner || null, blocked_reason: null, result: null, last_note: null, created_at: Date.now(), updated_at: Date.now() };
  await redisCommand(['HSET', TASKS_KEY, id, JSON.stringify(task)]);
  return task;
}

async function getTask(id) { const raw = await redisCommand(['HGET', TASKS_KEY, id]); if (!raw) throw new Error(`Task not found: ${id}`); return JSON.parse(raw); }
async function saveTask(task) { task.updated_at = Date.now(); await redisCommand(['HSET', TASKS_KEY, task.id, JSON.stringify(task)]); return task; }

export async function claimTask({ id, owner }) { const task = await getTask(id); task.owner = owner; if (task.status === 'idle') task.status = 'planning'; return saveTask(task); }
export async function updateProgress({ id, status, note }) { const task = await getTask(id); if (status) { if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`); task.status = status; } if (note) task.last_note = note; return saveTask(task); }
export async function markBlocked({ id, reason }) { const task = await getTask(id); task.status = 'blocked'; task.blocked_reason = reason; return saveTask(task); }
export async function attachResult({ id, result }) { const task = await getTask(id); task.result = result; return saveTask(task); }
export async function completeTask({ id, result }) { const task = await getTask(id); task.status = 'complete'; if (result) task.result = result; return saveTask(task); }

export async function postMessage({ from, message }) {
  const entry = { from, message, at: Date.now() };
  await redisCommand(['LPUSH', MESSAGES_KEY, JSON.stringify(entry)]);
  await redisCommand(['LTRIM', MESSAGES_KEY, '0', String(MESSAGE_LIMIT - 1)]);
  return entry;
}

export async function listMessages() {
  const raw = await redisCommand(['LRANGE', MESSAGES_KEY, '0', String(MESSAGE_LIMIT - 1)]);
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

export async function readBoard() {
  const [tasks, messages] = await Promise.all([listTasks(), listMessages()]);
  return { tasks, messages };
}
