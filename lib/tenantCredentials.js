// lib/tenantCredentials.js
// Encrypted-at-rest storage for OAuth tokens obtained on behalf of a
// BYO tenant (task 09). This is intentionally separate from
// lib/tenantProvisioning.js's tenant record, which only ever holds
// non-secret connection metadata (accountLogin, connected_at) -- the
// actual bearer token lives only here, encrypted, and is never
// returned by any API route or tool result. getTenantCredential is
// for future internal server-side use only (making an actual
// GitHub/Vercel API call on the tenant's behalf) -- nothing in this
// codebase currently calls it, and it must never be wired into
// anything that echoes its return value back to a client or an LLM
// tool result.
//
// Encryption key is derived from the existing
// NEXUS_GRANT_SIGNING_SECRET via a domain-separated SHA-256 hash,
// rather than requiring a brand new secret from Justin right now.
// This is a reasonable interim choice, not a permanent one -- a
// dedicated NEXUS_CREDENTIAL_ENC_KEY would be a clean follow-up
// hardening step so a credential-store compromise and a capability-
// grant-signing compromise aren't the same event.

import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CREDENTIALS_KEY = 'nexus:tenant:credentials';

function legacyEncryptionKey() {
  const secret = process.env.NEXUS_GRANT_SIGNING_SECRET;
  if (!secret) throw new Error('NEXUS_GRANT_SIGNING_SECRET is not configured');
  return crypto.createHash('sha256').update(secret + ':tenant-credential-encryption').digest();
}

function dedicatedEncryptionKey() {
  const secret = process.env.NEXUS_CREDENTIAL_ENC_KEY;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret + ':tenant-credential-encryption:v2').digest();
}

function encryptWithKey(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptWithKey(payload, key) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// New records use the dedicated, domain-separated credential key when
// configured. The v2 prefix is deliberately outside the ciphertext so
// legacy records remain readable during a no-downtime key migration.
function encrypt(plaintext) {
  const key = dedicatedEncryptionKey();
  return key ? 'v2:' + encryptWithKey(plaintext, key) : encryptWithKey(plaintext, legacyEncryptionKey());
}

function decrypt(payload) {
  if (typeof payload !== 'string') throw new Error('Invalid encrypted credential payload');
  if (payload.startsWith('v2:')) {
    const key = dedicatedEncryptionKey();
    if (!key) throw new Error('NEXUS_CREDENTIAL_ENC_KEY is required to read v2 tenant credentials');
    return decryptWithKey(payload.slice(3), key);
  }
  return decryptWithKey(payload, legacyEncryptionKey());
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
    console.error('tenantCredentials redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

function fieldKey(tenantId, provider) {
  return `${tenantId}:${provider}`;
}

export async function storeTenantCredential({ tenantId, provider, accessToken, refreshToken = null, expiresAt = null }) {
  if (!tenantId || !provider || !accessToken) throw new Error('tenantId, provider, and accessToken are required');
  const record = { accessToken, refreshToken, expiresAt, stored_at: Date.now() };
  const encrypted = encrypt(JSON.stringify(record));
  await redisCommand(['HSET', CREDENTIALS_KEY, fieldKey(tenantId, provider), encrypted]);
  return { stored: true };
}

// Presence check only -- safe to expose via API, since it never
// returns the token itself, only whether one exists.
export async function hasTenantCredential({ tenantId, provider }) {
  const raw = await redisCommand(['HGET', CREDENTIALS_KEY, fieldKey(tenantId, provider)]);
  return Boolean(raw);
}

// INTERNAL USE ONLY. Never call this from a route or tool handler
// whose result reaches a client or an LLM response -- it returns the
// live bearer token. Reserved for a future slice where Nexus actually
// acts on a tenant's behalf against their connected GitHub/Vercel.
export async function getTenantCredential({ tenantId, provider }) {
  const raw = await redisCommand(['HGET', CREDENTIALS_KEY, fieldKey(tenantId, provider)]);
  if (!raw) return null;
  return JSON.parse(decrypt(raw));
}

export async function deleteTenantCredential({ tenantId, provider }) {
  await redisCommand(['HDEL', CREDENTIALS_KEY, fieldKey(tenantId, provider)]);
  return { deleted: true };
}

export const __internals = { encrypt, decrypt };
