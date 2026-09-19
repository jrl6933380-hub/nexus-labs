// lib/forgeStack.js
// Durable, per-account/per-project full-stack setup state for Forge.
//
// This is the control plane, not a secret store. It records which pieces a
// project needs, which provider the customer selected, and whether the setup
// has honestly reached ready. OAuth tokens, API keys, database URLs, and other
// credentials belong behind the existing credential/capability boundary.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const STACK_VERSION = 1;
const STACK_KEY_PREFIX = 'nexus:forge:stack:';

export const STACK_STATES = Object.freeze([
  'not_needed',
  'recommended',
  'selected',
  'connecting',
  'connected',
  'testing',
  'ready',
  'error',
  'skipped',
]);

export const STACK_CATALOG = Object.freeze({
  brain: {
    label: 'Builder Brain',
    purpose: 'Plans the build and chooses Forge functions.',
    recommendedProvider: 'openrouter',
    providers: [{ id: 'openrouter', label: 'OpenRouter', mode: 'oauth-pkce', adapterStatus: 'ready' }],
  },
  auth: {
    label: 'Sign-in',
    purpose: 'Accounts, sessions, and protected areas.',
    recommendedProvider: 'forge-accounts',
    providers: [{ id: 'forge-accounts', label: 'Forge Accounts', mode: 'managed', adapterStatus: 'ready' }],
  },
  database: {
    label: 'Database',
    purpose: 'Durable application data.',
    recommendedProvider: 'neon',
    providers: [{ id: 'neon', label: 'Neon Postgres', mode: 'managed-or-byo', adapterStatus: 'ready' }],
  },
  storage: {
    label: 'File Storage',
    purpose: 'Images, uploads, and generated files.',
    recommendedProvider: 'vercel-blob',
    providers: [{ id: 'vercel-blob', label: 'Vercel Blob', mode: 'managed-or-byo', adapterStatus: 'planned' }],
  },
  deployment: {
    label: 'Hosting',
    purpose: 'Preview and production deployments.',
    recommendedProvider: 'vercel',
    providers: [{ id: 'vercel', label: 'Vercel', mode: 'managed-or-byo', adapterStatus: 'ready' }],
  },
  payments: {
    label: 'Payments',
    purpose: 'Checkout, subscriptions, and billing events.',
    recommendedProvider: 'stripe',
    providers: [{ id: 'stripe', label: 'Stripe', mode: 'oauth-or-managed', adapterStatus: 'ready' }],
  },
  email: {
    label: 'Email',
    purpose: 'Transactional messages and notifications.',
    recommendedProvider: 'resend',
    providers: [{ id: 'resend', label: 'Resend', mode: 'managed-or-byo', adapterStatus: 'ready' }],
  },
  domain: {
    label: 'Domain',
    purpose: 'A custom public address for the project.',
    recommendedProvider: 'vercel',
    providers: [{ id: 'vercel', label: 'Vercel Domains', mode: 'managed-or-byo', adapterStatus: 'ready' }],
  },
  observability: {
    label: 'Monitoring',
    purpose: 'Errors, health, and production diagnostics.',
    recommendedProvider: 'sentry',
    providers: [{ id: 'sentry', label: 'Sentry', mode: 'managed-or-byo', adapterStatus: 'ready' }],
  },
});

const TRANSITIONS = Object.freeze({
  not_needed: new Set(['recommended', 'selected']),
  recommended: new Set(['selected', 'connecting', 'skipped', 'error']),
  selected: new Set(['connecting', 'connected', 'recommended', 'error']),
  connecting: new Set(['connected', 'selected', 'error']),
  connected: new Set(['testing', 'ready', 'selected', 'error']),
  testing: new Set(['ready', 'connected', 'error']),
  ready: new Set(['testing', 'selected', 'error']),
  error: new Set(['recommended', 'selected', 'connecting', 'testing', 'skipped']),
  skipped: new Set(['recommended', 'selected']),
});

const ALWAYS_REQUIRED = new Set(['brain', 'deployment']);
const FEATURE_SLOTS = Object.freeze({
  accounts: ['auth', 'database'],
  login: ['auth', 'database'],
  users: ['auth', 'database'],
  bookings: ['auth', 'database', 'email'],
  forms: ['database', 'email'],
  dashboard: ['auth', 'database'],
  cms: ['auth', 'database', 'storage'],
  uploads: ['storage'],
  files: ['storage'],
  images: ['storage'],
  payments: ['payments', 'database'],
  subscriptions: ['payments', 'auth', 'database', 'email'],
  store: ['payments', 'database', 'storage', 'email'],
  email: ['email'],
  notifications: ['email'],
  domain: ['domain'],
  monitoring: ['observability'],
});

function normalizeOwner(ownerUsername) {
  const value = String(ownerUsername || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,120}$/.test(value)) throw new Error('A valid ownerUsername is required.');
  return value;
}

function normalizeProjectId(projectId = 'default') {
  const value = String(projectId || 'default').trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(value)) throw new Error('Invalid projectId.');
  return value;
}

function stackKey(ownerUsername) {
  return STACK_KEY_PREFIX + normalizeOwner(ownerUsername);
}

function assertSafeMetadata(value, path = 'metadata') {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.length > 50) throw new Error(path + ' is too large.');
    value.forEach((item, index) => assertSafeMetadata(item, path + '[' + index + ']'));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(token|secret|password|api.?key|credential|connection.?string|private.?key)/i.test(key)) {
      throw new Error('Stack metadata cannot contain credentials.');
    }
    assertSafeMetadata(child, path + '.' + key);
  }
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Redis command ' + command[0] + ' failed');
  return data.result;
}

export function createRedisStore() {
  return {
    async hget(key, field) {
      const raw = await redisCommand(['HGET', key, field]);
      return raw ? JSON.parse(raw) : null;
    },
    async hsetnx(key, field, value) {
      return redisCommand(['HSETNX', key, field, JSON.stringify(value)]);
    },
    async hset(key, field, value) {
      await redisCommand(['HSET', key, field, JSON.stringify(value)]);
    },
  };
}

export function createMemoryStore() {
  const hashes = new Map();
  const ensure = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  return {
    async hget(key, field) {
      const raw = ensure(key).get(field);
      return raw ? JSON.parse(raw) : null;
    },
    async hsetnx(key, field, value) {
      const hash = ensure(key);
      if (hash.has(field)) return 0;
      hash.set(field, JSON.stringify(value));
      return 1;
    },
    async hset(key, field, value) {
      ensure(key).set(field, JSON.stringify(value));
    },
  };
}

function cleanFeatures(features = []) {
  if (!Array.isArray(features)) throw new Error('features must be an array.');
  return [...new Set(features.map((value) => String(value).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}

export function recommendStack({ projectType = 'website', features = [] } = {}) {
  const normalizedType = String(projectType || 'website').trim().toLowerCase().slice(0, 80);
  const normalizedFeatures = cleanFeatures(features);
  const required = new Set(ALWAYS_REQUIRED);

  if (['app', 'saas', 'portal', 'marketplace', 'dashboard'].includes(normalizedType)) {
    required.add('auth');
    required.add('database');
  }
  if (['store', 'commerce'].includes(normalizedType)) normalizedFeatures.push('store');
  if (['booking', 'appointments'].includes(normalizedType)) normalizedFeatures.push('bookings');

  for (const feature of normalizedFeatures) {
    for (const slot of FEATURE_SLOTS[feature] || []) required.add(slot);
  }

  return {
    projectType: normalizedType,
    features: [...new Set(normalizedFeatures)],
    requiredSlots: [...required],
  };
}

function buildSlots(requiredSlots) {
  const required = new Set(requiredSlots);
  return Object.fromEntries(Object.entries(STACK_CATALOG).map(([slotId, definition]) => {
    const isRequired = required.has(slotId);
    return [slotId, {
      slot: slotId,
      required: isRequired,
      provider: isRequired ? definition.recommendedProvider : null,
      mode: null,
      status: isRequired ? 'recommended' : 'not_needed',
      metadata: {},
      error: null,
      updated_at: Date.now(),
      tested_at: null,
    }];
  }));
}

export function createStackManifest({ ownerUsername, projectId = 'default', projectName = 'My project', projectType, features } = {}) {
  const owner = normalizeOwner(ownerUsername);
  const id = normalizeProjectId(projectId);
  const recommendation = recommendStack({ projectType, features });
  const now = Date.now();
  return {
    version: STACK_VERSION,
    owner,
    project_id: id,
    project_name: String(projectName || 'My project').trim().slice(0, 100) || 'My project',
    project_type: recommendation.projectType,
    features: recommendation.features,
    slots: buildSlots(recommendation.requiredSlots),
    created_at: now,
    updated_at: now,
  };
}

export async function ensureStackManifest(input = {}) {
  const store = input.store || createRedisStore();
  const owner = normalizeOwner(input.ownerUsername);
  const projectId = normalizeProjectId(input.projectId);
  const key = stackKey(owner);
  const existing = await store.hget(key, projectId);
  if (existing) return existing;
  const manifest = createStackManifest({ ...input, ownerUsername: owner, projectId });
  const created = await store.hsetnx(key, projectId, manifest);
  return created === 1 ? manifest : store.hget(key, projectId);
}

export async function getStackManifest({ ownerUsername, projectId = 'default', store = createRedisStore() } = {}) {
  return store.hget(stackKey(ownerUsername), normalizeProjectId(projectId));
}

async function saveManifest(manifest, store) {
  manifest.updated_at = Date.now();
  await store.hset(stackKey(manifest.owner), manifest.project_id, manifest);
  return manifest;
}

export async function applyStackRecommendation({ ownerUsername, projectId = 'default', projectType, features, store = createRedisStore() } = {}) {
  const manifest = await ensureStackManifest({ ownerUsername, projectId, projectType, features, store });
  const recommendation = recommendStack({ projectType, features });
  const required = new Set(recommendation.requiredSlots);
  manifest.project_type = recommendation.projectType;
  manifest.features = recommendation.features;

  for (const [slotId, slot] of Object.entries(manifest.slots)) {
    const shouldRequire = required.has(slotId);
    slot.required = shouldRequire;
    if (shouldRequire && ['not_needed', 'skipped'].includes(slot.status)) {
      slot.status = 'recommended';
      slot.provider ||= STACK_CATALOG[slotId].recommendedProvider;
      slot.updated_at = Date.now();
    } else if (!shouldRequire && slot.status === 'recommended') {
      slot.status = 'not_needed';
      slot.provider = null;
      slot.updated_at = Date.now();
    }
  }
  return saveManifest(manifest, store);
}

function requireSlot(manifest, slotId) {
  const slot = manifest.slots?.[slotId];
  if (!slot || !STACK_CATALOG[slotId]) throw new Error('Unknown stack slot: ' + slotId);
  return slot;
}

export async function selectStackProvider({ ownerUsername, projectId = 'default', slotId, provider, mode = null, store = createRedisStore() } = {}) {
  const manifest = await ensureStackManifest({ ownerUsername, projectId, store });
  const slot = requireSlot(manifest, slotId);
  const allowed = STACK_CATALOG[slotId].providers.some((entry) => entry.id === provider);
  if (!allowed) throw new Error('Provider ' + provider + ' is not available for ' + slotId + '.');
  slot.required = true;
  slot.provider = provider;
  slot.mode = mode ? String(mode).slice(0, 40) : null;
  slot.status = 'selected';
  slot.error = null;
  slot.updated_at = Date.now();
  return saveManifest(manifest, store);
}

export async function setStackSlotState({ ownerUsername, projectId = 'default', slotId, status, metadata = {}, error = null, store = createRedisStore() } = {}) {
  if (!STACK_STATES.includes(status)) throw new Error('Invalid stack status.');
  assertSafeMetadata(metadata);
  const manifest = await ensureStackManifest({ ownerUsername, projectId, store });
  const slot = requireSlot(manifest, slotId);
  if (slot.status !== status && !TRANSITIONS[slot.status]?.has(status)) {
    throw new Error('Invalid stack transition: ' + slot.status + ' -> ' + status);
  }
  slot.status = status;
  slot.metadata = { ...slot.metadata, ...metadata };
  slot.error = error ? String(error).slice(0, 240) : null;
  slot.updated_at = Date.now();
  if (status === 'ready') slot.tested_at = Date.now();
  return saveManifest(manifest, store);
}

export async function resetStackSlot({ ownerUsername, projectId = 'default', slotId, store = createRedisStore() } = {}) {
  const manifest = await ensureStackManifest({ ownerUsername, projectId, store });
  const slot = requireSlot(manifest, slotId);
  slot.provider = slot.required ? STACK_CATALOG[slotId].recommendedProvider : null;
  slot.mode = null;
  slot.status = slot.required ? 'recommended' : 'not_needed';
  slot.metadata = {};
  slot.error = null;
  slot.tested_at = null;
  slot.updated_at = Date.now();
  return saveManifest(manifest, store);
}

export function stackProgress(manifest) {
  const required = Object.values(manifest?.slots || {}).filter((slot) => slot.required);
  const ready = required.filter((slot) => slot.status === 'ready');
  return {
    ready: ready.length,
    required: required.length,
    percent: required.length ? Math.round((ready.length / required.length) * 100) : 100,
    next: required.find((slot) => slot.status !== 'ready')?.slot || null,
  };
}

export function publicStack(manifest) {
  return { ...manifest, progress: stackProgress(manifest), catalog: STACK_CATALOG };
}

export const __internals = { normalizeOwner, normalizeProjectId, assertSafeMetadata, TRANSITIONS };
