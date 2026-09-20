// lib/forge/brainStore.js
//
// Storage for a Forge user's Builder Brain connection.
//
// Three things this file is responsible for, and they are the reason it exists
// separately from the provider adapter:
//
//   1. Encryption at rest. A provider key is a bearer credential that can spend
//      the user's money. It is encrypted with AES-256-GCM before it ever
//      reaches KV, so a leaked KV dump is not a leaked set of customer keys.
//
//   2. Tenant isolation. Every read and write is keyed by username and there is
//      no function here that returns a connection without one. There is
//      deliberately no "list all connections" or "get by id" helper: with one,
//      a single missing check in a route becomes one customer holding another
//      customer's key.
//
//   3. Never handing the secret upward by accident. `getConnection` returns the
//      record WITHOUT the key. Only `getProviderKey` decrypts, and it exists so
//      that grepping for its name finds every place a raw key can be obtained.

import crypto from 'node:crypto';

const KEY_PREFIX = 'forge:brain:';
const PENDING_PREFIX = 'forge:brain:pending:';
const PENDING_TTL_SECONDS = 15 * 60;

function kvConfig() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV is not configured');
  return { url, token };
}

async function kvFetch(path, options = {}) {
  const { url, token } = kvConfig();
  const response = await fetch(`${url}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`KV request failed (${response.status})`);
  return response.json();
}

async function kvGet(key) {
  const data = await kvFetch(`get/${encodeURIComponent(key)}`);
  if (data?.result == null) return null;
  // Upstash returns whatever text was stored. Anything that is not a JSON
  // object is treated as absent rather than returned: a half-written or
  // wrongly-encoded record must look like "no connection", never like a
  // connection whose fields are all undefined.
  try {
    const parsed = JSON.parse(data.result);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function kvSet(key, value, { ttlSeconds } = {}) {
  // The request body IS the stored value. Stringify exactly once: an earlier
  // version double-encoded here, so reads came back as a JSON *string* instead
  // of an object, every `record.secret` was undefined, and every connection
  // silently reported itself as not connected.
  const suffix = ttlSeconds ? `?EX=${ttlSeconds}` : '';
  await kvFetch(`set/${encodeURIComponent(key)}${suffix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

async function kvDel(key) {
  await kvFetch(`del/${encodeURIComponent(key)}`, { method: 'POST' });
}

// --- encryption ------------------------------------------------------------

/**
 * Accepts hex, base64, or a raw 32-char string so setting the env var is hard
 * to get subtly wrong. Throws rather than falling back to a default or to
 * plaintext — a missing key must stop the connection flow, not silently
 * downgrade it.
 */
function encryptionKey() {
  const raw = process.env.FORGE_ENCRYPTION_KEY;
  if (!raw) throw new Error('FORGE_ENCRYPTION_KEY is not set');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const base64 = Buffer.from(raw, 'base64');
  if (base64.length === 32) return base64;
  const utf8 = Buffer.from(raw, 'utf8');
  if (utf8.length === 32) return utf8;
  throw new Error('FORGE_ENCRYPTION_KEY must be 32 bytes (64 hex chars, base64, or 32 raw chars)');
}

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(payload) {
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unrecognised secret format');
  const [, iv, tag, data] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// --- pending authorizations ------------------------------------------------
// The PKCE verifier lives server-side, keyed by a random state value. The
// browser only ever holds the state. Expiring after 15 minutes means an
// abandoned or replayed callback fails closed.

export async function savePendingAuthorization(username, { state, codeVerifier, provider, tier }) {
  if (!username || !state) throw new Error('username and state are required');
  await kvSet(`${PENDING_PREFIX}${state}`, {
    username, codeVerifier, provider, tier, created_at: Date.now(),
  }, { ttlSeconds: PENDING_TTL_SECONDS });
}

/** Single-use: consuming a pending authorization deletes it, so a replayed callback fails. */
export async function consumePendingAuthorization(state) {
  if (!state) return null;
  const record = await kvGet(`${PENDING_PREFIX}${state}`);
  if (!record) return null;
  await kvDel(`${PENDING_PREFIX}${state}`);
  return record;
}

// --- connections -----------------------------------------------------------

export async function saveConnection(username, { provider, key, tier, models }) {
  if (!username) throw new Error('username is required');
  if (!key) throw new Error('key is required');
  await kvSet(`${KEY_PREFIX}${username}`, {
    provider,
    tier: tier || 'free',
    models: models || null,
    secret: encryptSecret(key),
    connected_at: Date.now(),
    tested_at: null,
  });
}

/** Connection metadata WITHOUT the secret. Safe to return from an API route. */
export async function getConnection(username) {
  if (!username) throw new Error('username is required');
  const record = await kvGet(`${KEY_PREFIX}${username}`);
  if (!record) return null;
  const { secret, ...safe } = record;
  return { ...safe, connected: Boolean(secret) };
}

/**
 * The ONLY path to a raw provider key. Server-side callers only — the result
 * must never be returned in an API response or written to a log.
 */
export async function getProviderKey(username) {
  if (!username) throw new Error('username is required');
  const record = await kvGet(`${KEY_PREFIX}${username}`);
  if (!record?.secret) return null;
  return decryptSecret(record.secret);
}

export async function markTested(username, patch = {}) {
  const record = await kvGet(`${KEY_PREFIX}${username}`);
  if (!record) return;
  await kvSet(`${KEY_PREFIX}${username}`, { ...record, ...patch, tested_at: Date.now() });
}

export async function setTier(username, tier) {
  const record = await kvGet(`${KEY_PREFIX}${username}`);
  if (!record) return null;
  await kvSet(`${KEY_PREFIX}${username}`, { ...record, tier });
  return tier;
}

export async function disconnect(username) {
  if (!username) throw new Error('username is required');
  await kvDel(`${KEY_PREFIX}${username}`);
}
