import crypto from 'crypto';

import { createOAuthState, verifyOAuthState } from './oauthState.js';
import { __internals as credentialCrypto } from './tenantCredentials.js';

const PENDING_PREFIX = 'nexus:forge:openrouter:oauth:';
const OAUTH_TTL_SECONDS = 10 * 60;

function normalizeOwner(value) {
  const owner = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,120}$/.test(owner)) throw new Error('A valid Forge account is required.');
  return owner;
}

function normalizeProjectId(value = 'default') {
  const projectId = String(value || 'default').trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(projectId)) throw new Error('Invalid projectId.');
  return projectId;
}

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value).digest(encoding);
}

function attemptKey(state) {
  return PENDING_PREFIX + sha256(state);
}

export function forgeCredentialScope({ ownerUsername, projectId = 'default' } = {}) {
  const owner = normalizeOwner(ownerUsername);
  const project = normalizeProjectId(projectId);
  return 'forge:' + sha256(owner + '\0' + project);
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: sha256(verifier, 'base64url'),
  };
}

function publicBaseUrl(env = process.env) {
  let candidate = env.FORGE_PUBLIC_URL || env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (!candidate) {
    if (env.NODE_ENV === 'production') throw new Error('FORGE_PUBLIC_URL is not configured.');
    candidate = 'http://localhost:3000';
  }
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;
  const parsed = new URL(candidate);
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('FORGE_PUBLIC_URL must use HTTPS in production.');
  }
  return parsed.origin;
}

async function redisCommand(command) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('OAuth state storage is unavailable.');
  return data.result;
}

export function createRedisAttemptStore() {
  return {
    async put(key, value, ttlSeconds) {
      const sealed = credentialCrypto.encrypt(JSON.stringify(value));
      const result = await redisCommand(['SET', key, sealed, 'EX', ttlSeconds, 'NX']);
      if (result !== 'OK') throw new Error('Could not start the OpenRouter connection.');
    },
    async take(key) {
      const sealed = await redisCommand(['GETDEL', key]);
      return sealed ? JSON.parse(credentialCrypto.decrypt(sealed)) : null;
    },
  };
}

export function createMemoryAttemptStore() {
  const values = new Map();
  return {
    async put(key, value, ttlSeconds) {
      if (values.has(key)) throw new Error('Duplicate OAuth attempt.');
      values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async take(key) {
      const entry = values.get(key);
      values.delete(key);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      return entry.value;
    },
  };
}

export async function beginOpenRouterOAuth({
  ownerUsername,
  projectId = 'default',
  store = createRedisAttemptStore(),
  env = process.env,
} = {}) {
  const owner = normalizeOwner(ownerUsername);
  const project = normalizeProjectId(projectId);
  const tenantId = forgeCredentialScope({ ownerUsername: owner, projectId: project });
  const state = createOAuthState({ tenant_id: tenantId, owner, provider: 'openrouter' });
  const { verifier, challenge } = createPkcePair();

  await store.put(attemptKey(state), {
    owner,
    projectId: project,
    tenantId,
    verifier,
  }, OAUTH_TTL_SECONDS);

  const callback = new URL('/api/openrouter-oauth', publicBaseUrl(env));
  callback.searchParams.set('action', 'callback');
  callback.searchParams.set('state', state);

  const authorize = new URL('https://openrouter.ai/auth');
  authorize.searchParams.set('callback_url', callback.toString());
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('key_label', 'Nexus Forge');

  return { authorizeUrl: authorize.toString(), tenantId, projectId: project };
}

function safeKeyMetadata(key, payload) {
  const data = payload?.data || {};
  const keyHash = sha256(key);
  return {
    key_hash: keyHash,
    is_free_tier: Boolean(data.is_free_tier),
    limit: Number.isFinite(data.limit) ? data.limit : null,
    limit_remaining: Number.isFinite(data.limit_remaining) ? data.limit_remaining : null,
    limit_reset: typeof data.limit_reset === 'string' ? data.limit_reset.slice(0, 40) : null,
    expires_at: typeof data.expires_at === 'string' ? data.expires_at.slice(0, 80) : null,
    connected_at: Date.now(),
    settings_url: `https://openrouter.ai/keys/${keyHash}`,
    logs_url: `https://openrouter.ai/logs?api_key_hash=${keyHash}`,
  };
}

export async function completeOpenRouterOAuth({
  state,
  code,
  ownerUsername,
  store = createRedisAttemptStore(),
  fetchFn = fetch,
} = {}) {
  const owner = normalizeOwner(ownerUsername);
  const signed = verifyOAuthState(state);
  if (signed.provider !== 'openrouter' || signed.owner !== owner) throw new Error('OAuth account mismatch.');
  if (!code || typeof code !== 'string') throw new Error('Missing OpenRouter authorization code.');

  const pending = await store.take(attemptKey(state));
  if (!pending) throw new Error('This OpenRouter connection expired or was already used.');
  if (pending.owner !== owner || pending.tenantId !== signed.tenant_id) throw new Error('OAuth attempt mismatch.');

  const exchange = await fetchFn('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: pending.verifier,
      code_challenge_method: 'S256',
    }),
  });
  const exchanged = await exchange.json().catch(() => ({}));
  const key = exchanged?.key;
  if (!exchange.ok || typeof key !== 'string' || key.length < 20) {
    throw new Error('OpenRouter did not authorize this connection.');
  }

  const check = await fetchFn('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
  });
  const keyInfo = await check.json().catch(() => ({}));
  if (!check.ok || !keyInfo?.data) throw new Error('OpenRouter connection test failed.');

  return {
    accessToken: key,
    tenantId: pending.tenantId,
    projectId: pending.projectId,
    metadata: safeKeyMetadata(key, keyInfo),
  };
}

export const __internals = { attemptKey, normalizeOwner, normalizeProjectId, publicBaseUrl, safeKeyMetadata };
