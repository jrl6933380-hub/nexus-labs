// lib/tenantProvisioning.js
// Task 09 (multi-tenant hosted/BYO provisioning) — first slice: the
// tenant record itself. A hosted tenant needs no GitHub/Vercel account
// of the owner's own; a BYO tenant records which external providers
// it has connected, but never stores raw credentials here — actual
// secrets stay behind lib/capabilityGateway.js's vault boundary, same
// separation used everywhere else in this repo. This module only
// answers: which tenants exist, who owns each one, and can a given
// caller see/touch a given tenant.
//
// Same raw-Redis-REST pattern and injectable-store shape as
// lib/codeVault.js, so this is unit-testable without live Redis.
// Same atomic-create discipline as lib/roomAuth.js's createUser fix
// (PR #55) — a duplicate/racing create must never overwrite an
// existing tenant record.

import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const TENANTS_KEY = 'nexus:tenants'; // slug -> tenant record (JSON)
const OWNER_INDEX_PREFIX = 'nexus:tenants:byowner:'; // + ownerUsername -> hash of tenantId -> slug

const MODES = ['hosted', 'byo'];
const DEFAULT_HOSTED_QUOTA = { creditsPerPeriod: 250, periodDays: 30 };

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('tenantProvisioning redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

function normalizeHash(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const obj = {};
    for (let i = 0; i < raw.length; i += 2) obj[raw[i]] = raw[i + 1];
    return obj;
  }
  return raw;
}

export function createRedisStore() {
  return {
    async hsetnx(key, field, value) {
      return redisCommand(['HSETNX', key, field, JSON.stringify(value)]);
    },
    async hget(key, field) {
      const raw = await redisCommand(['HGET', key, field]);
      return raw ? JSON.parse(raw) : null;
    },
    async hset(key, field, value) {
      await redisCommand(['HSET', key, field, JSON.stringify(value)]);
    },
    async hgetall(key) {
      const raw = await redisCommand(['HGETALL', key]);
      const obj = normalizeHash(raw);
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' ? JSON.parse(v) : v;
      return out;
    },
  };
}

export function createMemoryStore() {
  const hashes = new Map();
  function ensure(key) {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  }
  return {
    async hsetnx(key, field, value) {
      const h = ensure(key);
      if (h.has(field)) return 0;
      h.set(field, JSON.stringify(value));
      return 1;
    },
    async hget(key, field) {
      const raw = ensure(key).get(field);
      return raw ? JSON.parse(raw) : null;
    },
    async hset(key, field, value) {
      ensure(key).set(field, JSON.stringify(value));
    },
    async hgetall(key) {
      const out = {};
      for (const [k, v] of ensure(key)) out[k] = JSON.parse(v);
      return out;
    },
  };
}

function slugify(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function tenantSlug(ownerUsername, name) {
  return `${slugify(ownerUsername)}:${slugify(name)}`;
}

function validateMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}. Must be one of ${MODES.join(', ')}`);
}

/**
 * Create an isolated tenant. Hosted tenants need no external account
 * of their own (get a default credit quota); BYO tenants start with
 * no quota and add provider connections separately via
 * registerConnection(). Atomic: a racing duplicate create for the
 * same owner+name never overwrites the winner (HSETNX, same fix
 * pattern as PR #55).
 */
export async function createTenant({ ownerUsername, name, mode, store = createRedisStore() } = {}) {
  if (!ownerUsername || !String(ownerUsername).trim()) throw new Error('ownerUsername is required');
  if (!name || !String(name).trim()) throw new Error('name is required');
  validateMode(mode);

  const slug = tenantSlug(ownerUsername, name);
  const tenantId = crypto.randomUUID();
  const record = {
    tenant_id: tenantId,
    owner: ownerUsername,
    name: String(name).trim(),
    slug,
    mode,
    quota: mode === 'hosted' ? { ...DEFAULT_HOSTED_QUOTA } : null,
    connections: {}, // provider -> { connected_at, accountLogin } — no secrets, ever
    created_at: Date.now(),
  };

  const created = await store.hsetnx(TENANTS_KEY, slug, record);
  if (created === 0) throw new Error('A tenant with that name already exists for this owner.');
  if (created !== 1) throw new Error('Could not create tenant. Try again.');

  await store.hset(OWNER_INDEX_PREFIX + slugify(ownerUsername), tenantId, slug);
  return record;
}

export async function getTenantBySlug({ ownerUsername, name, store = createRedisStore() } = {}) {
  return store.hget(TENANTS_KEY, tenantSlug(ownerUsername, name));
}

/**
 * List only the tenants owned by this exact username — the owner
 * index is keyed per-owner, so there is no query shape that can leak
 * another owner's tenant into this result.
 */
export async function listTenantsForOwner({ ownerUsername, store = createRedisStore() } = {}) {
  const index = await store.hgetall(OWNER_INDEX_PREFIX + slugify(ownerUsername));
  const out = [];
  for (const slug of Object.values(index)) {
    const record = await store.hget(TENANTS_KEY, slug);
    if (record) out.push(record);
  }
  return out;
}

/**
 * Isolation check: throws unless the given tenant exists AND is owned
 * by ownerUsername. Every tenant-scoped operation should call this
 * first rather than trusting a tenant_id supplied by the caller.
 */
export async function assertTenantAccess({ tenantId, ownerUsername, store = createRedisStore() } = {}) {
  const index = await store.hgetall(OWNER_INDEX_PREFIX + slugify(ownerUsername));
  const slug = index[tenantId];
  if (!slug) throw new Error('Tenant not found or not owned by this account.');
  const record = await store.hget(TENANTS_KEY, slug);
  if (!record || record.tenant_id !== tenantId) throw new Error('Tenant not found or not owned by this account.');
  return record;
}

/**
 * Record that a BYO tenant has connected an external provider
 * (github, vercel, ...). metadata must not contain secrets — this is
 * a record that a connection exists, not the connection itself. The
 * actual OAuth/API credential belongs in the capability gateway's
 * vault (lib/capabilityGateway.js), keyed by tenant_id, never here.
 */
export async function registerConnection({ tenantId, ownerUsername, provider, metadata = {}, store = createRedisStore() } = {}) {
  if (!provider || !String(provider).trim()) throw new Error('provider is required');
  const forbidden = ['token', 'secret', 'password', 'key', 'credential'];
  for (const field of Object.keys(metadata)) {
    if (forbidden.some((f) => field.toLowerCase().includes(f))) {
      throw new Error(`metadata field "${field}" looks like a credential and cannot be stored here — use the capability gateway vault instead.`);
    }
  }

  const record = await assertTenantAccess({ tenantId, ownerUsername, store });
  record.connections[provider] = { ...metadata, connected_at: Date.now() };
  const index = await store.hgetall(OWNER_INDEX_PREFIX + slugify(ownerUsername));
  const slug = index[tenantId];
  await store.hset(TENANTS_KEY, slug, record);
  return record;
}

/**
 * Remove a provider connection after the caller has revoked the
 * corresponding credential. This is intentionally idempotent so an
 * interrupted disconnect can be safely retried without exposing state.
 */
export async function unregisterConnection({ tenantId, ownerUsername, provider, store = createRedisStore() } = {}) {
  if (!provider || !String(provider).trim()) throw new Error('provider is required');
  const record = await assertTenantAccess({ tenantId, ownerUsername, store });
  if (!Object.prototype.hasOwnProperty.call(record.connections, provider)) {
    return { tenant: record, disconnected: false };
  }
  delete record.connections[provider];
  const index = await store.hgetall(OWNER_INDEX_PREFIX + slugify(ownerUsername));
  await store.hset(TENANTS_KEY, index[tenantId], record);
  return { tenant: record, disconnected: true };
}

export const __internals = { MODES, DEFAULT_HOSTED_QUOTA, tenantSlug };
