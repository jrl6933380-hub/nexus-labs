// /lib/agentLog.js
// Rolling per-agent conversation log — a lightweight companion to
// Hyperfocus, not a replacement. Hyperfocus is a deliberate,
// topic-scoped handoff that discards its raw content on close. This
// is a small standing FIFO window (last few exchanges) per agent
// conversation (nex / claude / chatgpt), meant to be populated
// routinely — without being asked — so a quick "check what me and
// Chat were doing" works without a formal Hyperfocus handoff having
// been opened first.
//
// Reuses Hyperfocus's secret redaction and untrusted-context envelope
// rather than duplicating them — same injection surface (this is
// still free text moving between conversations), same defenses.

import { redactSecrets, wrapUntrusted } from './hyperfocus.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const KEY_PREFIX = 'nexus:agentlog';
const MAX_ENTRIES = 3;
const MAX_ENTRY_BYTES = 8 * 1024;
const IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, reset on every touch — self-clears only if abandoned

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('agentLog redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export function createRedisStore() {
  return {
    async get(key) {
      const raw = await redisCommand(['GET', key]);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, value, ttlMs) {
      const args = ['SET', key, JSON.stringify(value)];
      if (ttlMs) args.push('PX', String(Math.round(ttlMs)));
      await redisCommand(args);
    },
  };
}

export function createMemoryStore() {
  const docs = new Map();
  return {
    async get(key) {
      const hit = docs.get(key);
      return hit ? JSON.parse(hit) : null;
    },
    async set(key, value) {
      docs.set(key, JSON.stringify(value));
    },
  };
}

function normalizeAgent(agent) {
  const id = String(agent || '').trim().toLowerCase();
  if (!id) throw new Error('agent is required');
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) throw new Error(`Invalid agent id: ${agent}`);
  return id;
}

function truncate(text) {
  const str = String(text ?? '');
  if (Buffer.byteLength(str, 'utf8') <= MAX_ENTRY_BYTES) return str;
  return `${str.slice(0, MAX_ENTRY_BYTES)}\n\n[truncated at ${MAX_ENTRY_BYTES} bytes]`;
}

function keyFor(agent, tenantId, projectId) {
  return `${KEY_PREFIX}:${tenantId}:${projectId}:${agent}`;
}

/**
 * Append one exchange summary to an agent's rolling log. Keeps only
 * the last MAX_ENTRIES — the oldest entry rolls off as a new one is
 * added. Meant to be called routinely, without being asked, after a
 * meaningful exchange — the calling tool's own description is where
 * that behavioral instruction actually lives.
 */
export async function logExchange({
  agent,
  summary,
  tenant_id = 'default',
  project_id = 'nexus-labs',
  store = createRedisStore(),
} = {}) {
  const actor = normalizeAgent(agent);
  if (!summary || !String(summary).trim()) throw new Error('summary is required');

  const key = keyFor(actor, tenant_id, project_id);
  const existing = (await store.get(key)) || { agent: actor, entries: [] };

  existing.entries.push({
    text: truncate(redactSecrets(String(summary).trim())),
    at: Date.now(),
  });
  if (existing.entries.length > MAX_ENTRIES) {
    existing.entries = existing.entries.slice(-MAX_ENTRIES);
  }
  existing.updated_at = Date.now();

  await store.set(key, existing, IDLE_TTL_MS);
  return { agent: actor, entry_count: existing.entries.length, rolled_off: existing.entries.length >= MAX_ENTRIES };
}

/**
 * Read back an agent's current rolling window, wrapped as untrusted
 * context — same envelope Hyperfocus uses, since this is still free
 * text moving between conversations.
 */
export async function checkAgentLog({
  agent,
  tenant_id = 'default',
  project_id = 'nexus-labs',
  store = createRedisStore(),
} = {}) {
  const actor = normalizeAgent(agent);
  const key = keyFor(actor, tenant_id, project_id);
  const record = await store.get(key);

  if (!record || !record.entries || record.entries.length === 0) {
    return {
      agent: actor,
      entry_count: 0,
      content: wrapUntrusted(`No recent exchanges logged yet for "${actor}".`),
    };
  }

  const body = [
    `# Recent exchanges with ${actor}`,
    `(last ${record.entries.length} of up to ${MAX_ENTRIES}, oldest first)`,
    '',
    ...record.entries.map((e, i) => `## ${i + 1}. ${new Date(e.at).toISOString()}\n${e.text}`),
  ].join('\n\n');

  return {
    agent: actor,
    entry_count: record.entries.length,
    updated_at: record.updated_at,
    content: wrapUntrusted(body),
  };
}

export const __internals = { MAX_ENTRIES, MAX_ENTRY_BYTES, IDLE_TTL_MS };
