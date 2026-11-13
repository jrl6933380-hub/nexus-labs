import './store/installFetch.js';
// Permanent running history ("timeline") shared by Justin, Claude, ChatGPT and Nex. Append-only, newest first.
// Justin saves an entry from the Agent Board when he finishes working; agents add theirs by posting a board message
// that starts with [TIMELINE]. Secrets are redacted before anything is stored.
import crypto from 'node:crypto';
import { redactFields } from './secretScan.js';

const KV_URL = process.env.KV_REST_API_URL, KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'nexus:timeline';
export const TIMELINE_LIMIT = 1000;
export const TIMELINE_TAG = '[TIMELINE]';
const KINDS = ['save', 'agent'];

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('Timeline store failed.');
  return data.result;
}
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, n);

export function buildEntry({ by, did, next, kind = 'save' }, now = Date.now()) {
  const who = clip(by, 24).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'justin';
  const { fields, secret_check } = redactFields({ did: clip(did, 2000), next: clip(next, 1000) });
  if (!fields.did) return { error: 'Write what was done first.' };
  const entry = { id: crypto.randomBytes(6).toString('hex'), at: now, by: who, kind: KINDS.includes(kind) ? kind : 'save', did: fields.did, next: fields.next || '' };
  if (secret_check) entry.secret_check = secret_check;
  return { entry };
}

export async function addEntry(input, { redis = redisCommand, now = Date.now } = {}) {
  const b = buildEntry(input, now());
  if (b.error) return b;
  await redis(['LPUSH', KEY, JSON.stringify(b.entry)]);
  await redis(['LTRIM', KEY, '0', String(TIMELINE_LIMIT - 1)]);
  return b;
}

export async function listEntries(limit = 50, { redis = redisCommand } = {}) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const raw = await redis(['LRANGE', KEY, '0', String(n - 1)]);
  return (Array.isArray(raw) ? raw : []).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

// For agent messages: "[TIMELINE] did this. NEXT: that" -> entry. Returns null if the message is not tagged.
export function parseTimelineMessage(from, message) {
  const m = String(message || '');
  if (!m.trimStart().toUpperCase().startsWith(TIMELINE_TAG)) return null;
  const body = m.trimStart().slice(TIMELINE_TAG.length).trim();
  const i = body.search(/\bNEXT:/i);
  const did = i === -1 ? body : body.slice(0, i).trim();
  const next = i === -1 ? '' : body.slice(i + 5).trim();
  return { by: from, did, next, kind: 'agent' };
}
