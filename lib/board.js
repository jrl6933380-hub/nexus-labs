// /lib/board.js
// Shared task board for multi-agent coordination between Claude, GPT,
// and Nex — so nobody overwrites someone else's in-progress work blind,
// and everyone can see who's doing what before diving in. This is the
// direct fix for tonight's collision: GPT and Claude both editing
// lib/sandbox.js without knowing about each other's changes.

import { redactFields } from './secretScan.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TASKS_KEY = 'nexus:board:tasks';
const MESSAGES_KEY = 'nexus:board:messages';
const MESSAGE_LIMIT = 50;
const VALID_STATUSES = ['idle', 'planning', 'building', 'testing', 'blocked', 'waiting_for_justin', 'complete'];
const DEFAULT_STALE_BLOCKED_MS = 6 * 60 * 60 * 1000;
const MIN_STALE_BLOCKED_MS = 15 * 60 * 1000;
const MAX_STALE_BLOCKED_MS = 30 * 24 * 60 * 60 * 1000;

function staleBlockedThreshold() {
  const configured = Number(process.env.BOARD_STALE_BLOCKED_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_STALE_BLOCKED_MS;
  return Math.max(MIN_STALE_BLOCKED_MS, Math.min(configured, MAX_STALE_BLOCKED_MS));
}

export function annotateStaleBlockedTasks(tasks, { now = Date.now(), thresholdMs = staleBlockedThreshold() } = {}) {
  return tasks.map((task) => {
    const { stale_check: _previousCheck, ...current } = task;
    const lastUpdate = Number(task.updated_at || task.created_at);
    const blockedFor = now - lastUpdate;
    if (task.status !== 'blocked' || !Number.isFinite(lastUpdate) || blockedFor < thresholdMs) {
      return current;
    }
    return {
      ...current,
      stale_check: {
        flagged: true,
        blocked_for_ms: blockedFor,
        threshold_ms: thresholdMs,
        checked_at: now,
      },
    };
  });
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('board redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export async function listTasks() {
  const raw = await redisCommand(['HGETALL', TASKS_KEY]);
  if (!raw || !Array.isArray(raw)) return [];
  const tasks = [];
  for (let i = 0; i < raw.length; i += 2) {
    try {
      tasks.push(JSON.parse(raw[i + 1]));
    } catch {
      // skip a malformed entry rather than crashing the whole list
    }
  }
  tasks.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  return annotateStaleBlockedTasks(tasks);
}

// Normalizes a title for comparison: lowercase, trim, collapse internal
// whitespace runs to single spaces. Deliberately simple (exact match on
// the normalized form) rather than fuzzy/Levenshtein — catches the real
// case that prompted this (the literal string "Direct Claude takeover"
// created four times, "TEST — Claude Routine wake" four times) without
// the false-positive risk of a fuzzy matcher on short titles.
function normalizeTitle(title) {
  return String(title || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Non-blocking duplicate check, same shape/philosophy as completeTask's
// claim_check below: never prevents the action, just attaches a visible
// flag so a human or agent reading the board sees the near-duplicate
// instead of silently creating another copy of "Direct Claude takeover".
async function findDuplicateTasks(title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return [];
  const existing = await listTasks();
  return existing
    .filter((t) => t.status !== 'complete' && normalizeTitle(t.title) === normalized)
    .map((t) => t.id);
}

export async function createTask({ title, description, owner }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { fields, secret_check } = redactFields({ title: title || '', description: description || '' });

  const task = {
    id,
    title: fields.title,
    description: fields.description,
    status: owner ? 'planning' : 'idle',
    owner: owner || null,
    blocked_reason: null,
    result: null,
    last_note: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  if (secret_check) task.secret_check = secret_check;

  const duplicateIds = await findDuplicateTasks(task.title);
  if (duplicateIds.length > 0) {
    task.duplicate_check = {
      flagged: true,
      matched_task_ids: duplicateIds,
      flagged_at: Date.now(),
    };
  }

  await redisCommand(['HSET', TASKS_KEY, id, JSON.stringify(task)]);
  return task;
}

async function getTask(id) {
  const raw = await redisCommand(['HGET', TASKS_KEY, id]);
  if (!raw) throw new Error(`Task not found: ${id}`);
  return JSON.parse(raw);
}

async function saveTask(task) {
  task.updated_at = Date.now();
  await redisCommand(['HSET', TASKS_KEY, task.id, JSON.stringify(task)]);
  return task;
}

export async function claimTask({ id, owner }) {
  const task = await getTask(id);
  task.owner = owner;
  if (task.status === 'idle') task.status = 'planning';
  return saveTask(task);
}

export async function updateProgress({ id, status, note }) {
  const task = await getTask(id);
  if (status) {
    if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
    task.status = status;
  }
  if (note) {
    const { fields, secret_check } = redactFields({ note });
    task.last_note = fields.note;
    if (secret_check) task.secret_check = secret_check;
  }
  return saveTask(task);
}

export async function markBlocked({ id, reason }) {
  const task = await getTask(id);
  const { fields, secret_check } = redactFields({ reason: reason || '' });
  task.status = 'blocked';
  task.blocked_reason = fields.reason;
  if (secret_check) task.secret_check = secret_check;
  return saveTask(task);
}

export async function attachResult({ id, result }) {
  const task = await getTask(id);
  const { fields, secret_check } = redactFields({ result: result || '' });
  task.result = fields.result;
  if (secret_check) task.secret_check = secret_check;
  return saveTask(task);
}

// Phrases that, if present in a task's own text at the moment it's
// marked complete, usually mean the completion is premature — the
// agent's own words are admitting the work isn't actually finished.
// This is exactly what caught the Execution Ledger task tonight:
// status said "planning" and the note said "runtime auto-capture is
// intentionally not wired yet" — a human had to notice that by
// reading it. This makes that same catch automatic and non-blocking:
// it never prevents a completion, it just attaches a visible flag so
// anyone reading the board sees the mismatch instead of trusting the
// status silently.
const CLAIM_MISMATCH_PHRASES = [
  'not wired yet',
  'not yet wired',
  'not started',
  'not yet implemented',
  'not implemented yet',
  'not yet built',
  'not built yet',
  'todo',
  'to-do',
  'pending',
  'placeholder only',
  'still needs',
  'no runtime',
  'not runtime-complete',
  'not live yet',
  'not yet live',
];

function findClaimMismatch(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  return CLAIM_MISMATCH_PHRASES.find((phrase) => lower.includes(phrase)) || null;
}

export async function completeTask({ id, result }) {
  const task = await getTask(id);

  const { fields, secret_check } = redactFields({ result: result || '' });
  const redactedResult = result ? fields.result : null;
  if (secret_check) task.secret_check = secret_check;

  const textToScan = [redactedResult, task.last_note].filter(Boolean).join(' \n ');
  const mismatch = findClaimMismatch(textToScan);

  task.status = 'complete';
  if (redactedResult) task.result = redactedResult;

  if (mismatch) {
    task.claim_check = {
      flagged: true,
      matched_phrase: mismatch,
      flagged_at: Date.now(),
    };
  } else if (task.claim_check) {
    delete task.claim_check;
  }

  return saveTask(task);
}

export async function postMessage({ from, message }) {
  const { fields, secret_check } = redactFields({ message: message || '' });
  const entry = { from, message: fields.message, at: Date.now() };
  if (secret_check) entry.secret_check = secret_check;
  await redisCommand(['LPUSH', MESSAGES_KEY, JSON.stringify(entry)]);
  await redisCommand(['LTRIM', MESSAGES_KEY, '0', String(MESSAGE_LIMIT - 1)]);
  return entry;
}

export async function listMessages() {
  const raw = await redisCommand(['LRANGE', MESSAGES_KEY, '0', String(MESSAGE_LIMIT - 1)]);
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((r) => {
    try {
      return JSON.parse(r);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function readBoard() {
  const [tasks, messages] = await Promise.all([listTasks(), listMessages()]);
  return { tasks, messages };
}
