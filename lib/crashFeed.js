// /lib/crashFeed.js
// Sentry -> Nexus Crash Feed normalization, redaction, deduplication, and repair linkage.

import crypto from 'crypto';
import { createTask } from './board.js';

const CRASH_KEY = 'nexus:crash:records';
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /token|secret|password|cookie|authorization|api[_-]?key|access[_-]?key|client[_-]?secret|dsn/i;
const memory = new Map();

function redisConfigured() { return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN); }
async function redis(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) throw new Error('Crash feed storage unavailable');
  return data.result;
}
function safeKey(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 40); }
function storeFor(store) { return store || { get: async (k) => redis(['HGET', CRASH_KEY, k]), set: async (k, v) => redis(['HSET', CRASH_KEY, k, v]), list: async () => redis(['HVALS', CRASH_KEY]) }; }
function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value
    .replace(/(Bearer\\s+)[^\\s]+/gi, '$1' + REDACTED)
    .replace(/([?&](?:token|key|secret|signature|password)=)[^&]+/gi, '$1' + REDACTED)
    .slice(0, 4000);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, seen);
  return output;
}
function first(...values) { return values.find((value) => value !== undefined && value !== null && value !== '') || null; }

export function verifySentrySignature(rawBody, signature, secret = process.env.SENTRY_WEBHOOK_SECRET) {
  if (!secret || !rawBody || !signature) return false;
  const supplied = String(signature).replace(/^sha256=/i, '').trim();
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(rawBody)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

export function normalizeSentryEvent(input, now = Date.now()) {
  const event = redact(input || {});
  const exception = event.exception?.values?.[0] || {};
  const tags = event.tags || event.metadata?.tags || {};
  const issueId = String(first(event.issue_id, event.issue?.id, event.group_id, event.id, 'unknown'));
  const fingerprint = first(event.fingerprint?.join?.(':'), event.fingerprint, event.issue?.shortId, issueId);
  const route = first(tags.route, tags.transaction, event.transaction, event.request?.url);
  const deployment = first(tags.deployment, tags.vercel_deployment, event.contexts?.trace?.op, event.deployment);
  const commit = first(tags.commit, tags.git_commit, event.release, event.commit);
  return {
    id: `crash_${safeKey(fingerprint)}`,
    issue_id: issueId,
    fingerprint: String(fingerprint),
    title: String(first(event.title, event.message, exception.type, 'Sentry issue')),
    level: String(first(event.level, event.issue?.level, 'error')),
    culprit: first(event.culprit, event.transaction, route),
    route: route ? String(route).slice(0, 500) : null,
    deployment: deployment ? String(deployment).slice(0, 200) : null,
    commit: commit ? String(commit).slice(0, 200) : null,
    count: 1,
    first_seen: now,
    last_seen: now,
    status: 'open',
    repair_task_id: null,
    source: 'sentry',
    event: { tags, exception: exception.type || exception.value ? { type: exception.type || null, value: exception.value || null } : null },
  };
}

export async function ingestSentryCrash(input, { store: providedStore, now = Date.now(), createRepairTask = createTask } = {}) {
  const store = storeFor(providedStore);
  const incoming = normalizeSentryEvent(input, now);
  const existingRaw = await store.get(incoming.id);
  const record = existingRaw ? (typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw) : incoming;
  if (existingRaw) {
    record.count = Number(record.count || 0) + 1;
    record.last_seen = now;
    record.title = incoming.title;
    record.level = incoming.level;
    record.route = incoming.route || record.route;
    record.deployment = incoming.deployment || record.deployment;
    record.commit = incoming.commit || record.commit;
  }
  if ((!record.repair_task_id && (record.count >= 3 || ['fatal', 'error'].includes(record.level))) && createRepairTask) {
    const task = await createRepairTask({
      title: `Repair Sentry crash: ${record.title}`,
      description: `Sentry issue ${record.issue_id} recurred ${record.count} time(s). Route: ${record.route || 'unknown'}; deployment: ${record.deployment || 'unknown'}; commit: ${record.commit || 'unknown'}.`,
      owner: null,
    });
    record.repair_task_id = task.id;
  }
  await store.set(record.id, JSON.stringify(record));
  return record;
}

export async function listCrashes({ store: providedStore, limit = 50 } = {}) {
  const store = storeFor(providedStore);
  const raw = await store.list();
  return (raw || []).map((item) => typeof item === 'string' ? JSON.parse(item) : item)
    .sort((a, b) => Number(b.last_seen || 0) - Number(a.last_seen || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}
export async function getCrash(id, { store: providedStore } = {}) {
  if (!id) throw new Error('Crash id is required');
  const store = storeFor(providedStore);
  const raw = await store.get(id);
  return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
}
export function createMemoryCrashStore() {
  return { get: async (key) => memory.get(key) || null, set: async (key, value) => { memory.set(key, value); return 'OK'; }, list: async () => [...memory.values()] };
}
