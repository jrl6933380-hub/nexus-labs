import './store/installFetch.js';
// Private demo links. One unguessable link per lead shows all three looks in one swipeable page.
// A link only reveals the saved previews (which already carry the SAMPLE PREVIEW banner). It never sends anything.
import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL, KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const LINK_TTL_SECONDS = 30 * 24 * 3600;
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
const tokenKey = t => `nexus:forge:demo:t:${t}`;
const leadKey = id => `nexus:forge:demo:lead:${id}`;

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('Demo link store failed.');
  return data.result;
}

export async function getLink(token, { redis = redisCommand } = {}) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const raw = await redis(['GET', tokenKey(token)]);
  if (!raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v.leadId === 'string' ? v : null; } catch { return null; }
}

// Reuses the lead's live link so the caller always copies the same URL; makes a new one if none or expired.
export async function createLink(leadId, by, { redis = redisCommand, now = Date.now, rand = () => crypto.randomBytes(18).toString('base64url') } = {}) {
  const existing = await redis(['GET', leadKey(leadId)]);
  if (existing && await getLink(existing, { redis })) return { token: existing, reused: true };
  const token = rand();
  const record = JSON.stringify({ leadId, by: by || null, createdAt: now() });
  await redis(['SET', tokenKey(token), record, 'EX', String(LINK_TTL_SECONDS)]);
  await redis(['SET', leadKey(leadId), token, 'EX', String(LINK_TTL_SECONDS)]);
  return { token, reused: false };
}

export async function revokeLink(leadId, { redis = redisCommand } = {}) {
  const token = await redis(['GET', leadKey(leadId)]);
  if (token) await redis(['DEL', tokenKey(token)]);
  await redis(['DEL', leadKey(leadId)]);
  return { revoked: Boolean(token) };
}

// Allows 60 views a minute per address so the public endpoint cannot be hammered.
export async function allowView(ip, { redis = redisCommand, now = Date.now, limit = 60 } = {}) {
  const key = `nexus:forge:demo:rl:${String(ip || 'unknown').slice(0, 64)}:${Math.floor(now() / 60000)}`;
  const n = Number(await redis(['INCR', key]));
  if (n === 1) await redis(['EXPIRE', key, '90']);
  return n <= limit;
}
