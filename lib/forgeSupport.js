import './store/installFetch.js';
// Customer support without logins. Each customer gets a private support link (random token). The link opens a simple
// message form; messages land in a Forge Ops inbox and on the Agent Board. Customers never sign in to anything.
import crypto from 'node:crypto';
import { redactFields } from './secretScan.js';

const KV_URL = process.env.KV_REST_API_URL, KV_TOKEN = process.env.KV_REST_API_TOKEN;
const INBOX = 'nexus:forge:support';
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
export const INBOX_LIMIT = 500;
const tokKey = t => `nexus:forge:support:t:${t}`;
const bizKey = id => `nexus:forge:support:biz:${id}`;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, n);

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('Support store failed.');
  return data.result;
}

// One stable token per business key (lead id or client id), so the same link is always handed out.
export async function supportTokenFor(key, businessName, { redis = redisCommand, rand = () => crypto.randomBytes(18).toString('base64url') } = {}) {
  const k = clip(key, 80);
  if (!k) throw new Error('A business key is required.');
  const existing = await redis(['GET', bizKey(k)]);
  if (existing && TOKEN_RE.test(existing)) return existing;
  const token = rand();
  await redis(['SET', tokKey(token), JSON.stringify({ key: k, businessName: clip(businessName, 100) })]);
  await redis(['SET', bizKey(k), token]);
  return token;
}
export async function readToken(token, { redis = redisCommand } = {}) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const raw = await redis(['GET', tokKey(token)]);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function addMessage(token, { name, contact, message }, { redis = redisCommand, now = Date.now } = {}) {
  const biz = await readToken(token, { redis });
  if (!biz) return { error: 'This support link is not valid.', status: 404 };
  const text = clip(message, 1500);
  if (text.length < 3) return { error: 'Write a short message first.', status: 400 };
  const { fields, secret_check } = redactFields({ message: text, name: clip(name, 80), contact: clip(contact, 120) });
  const entry = { id: crypto.randomBytes(6).toString('hex'), at: now(), key: biz.key, businessName: biz.businessName, name: fields.name, contact: fields.contact, message: fields.message, status: 'new' };
  if (secret_check) entry.secret_check = secret_check;
  await redis(['LPUSH', INBOX, JSON.stringify(entry)]);
  await redis(['LTRIM', INBOX, '0', String(INBOX_LIMIT - 1)]);
  return { entry };
}
export async function listMessages(limit = 100, { redis = redisCommand } = {}) {
  const raw = await redis(['LRANGE', INBOX, '0', String(Math.max(1, Math.min(INBOX_LIMIT, Number(limit) || 100)) - 1)]);
  return (Array.isArray(raw) ? raw : []).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}
export async function setMessageStatus(id, status, { redis = redisCommand } = {}) {
  if (!['new', 'done'].includes(status)) return { error: 'Status must be new or done.' };
  const raw = await redis(['LRANGE', INBOX, '0', String(INBOX_LIMIT - 1)]);
  const list = (Array.isArray(raw) ? raw : []);
  for (let i = 0; i < list.length; i++) {
    let m; try { m = JSON.parse(list[i]); } catch { continue; }
    if (m.id === id) { m.status = status; await redis(['LSET', INBOX, String(i), JSON.stringify(m)]); return { entry: m }; }
  }
  return { error: 'No such message.' };
}
// Per-address limit so the public form cannot be flooded: 8 messages an hour.
export async function allowSend(ip, { redis = redisCommand, now = Date.now, limit = 8 } = {}) {
  const key = `nexus:forge:support:rl:${String(ip || 'unknown').slice(0, 64)}:${Math.floor(now() / 3600000)}`;
  const n = Number(await redis(['INCR', key]));
  if (n === 1) await redis(['EXPIRE', key, '4000']);
  return n <= limit;
}
