// /lib/codeVault.js
// Glass Wing Code Vault — shared, versioned technical memory for how
// Nexus reliably builds (epic task 1788400797020-2iqfb5). First real
// slice: the Blueprints storage + search mechanism, so an agent can
// search-before-generate instead of reinventing structure every site.
// Modules and Blocks (levels 2-3) use the exact same storage shape —
// level is just a field — so extending to those later is a data
// addition, not a new mechanism.
//
// v1 scope: metadata + search + versioning. Full embedded source
// snippets are a Blocks/Modules-level concern for later — Blueprint
// entries in this slice point to where the real, already-proven code
// lives (a Room build pattern, a dashboard shell) rather than
// duplicating it, so there is exactly one place that code is
// maintained and kept current.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const KEY_PREFIX = 'nexus:vault';
const INDEX_KEY = `${KEY_PREFIX}:index`;
const LEVELS = ['blueprint', 'module', 'block'];
const LIFECYCLE_STATUSES = ['experimental', 'tested', 'proven', 'deprecated'];

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('codeVault redisCommand failed', command[0], res.status);
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
    async set(key, value) {
      await redisCommand(['SET', key, JSON.stringify(value)]);
    },
    async hgetall(key) {
      const raw = await redisCommand(['HGETALL', key]);
      return raw || {};
    },
    async hset(key, field, value) {
      await redisCommand(['HSET', key, field, JSON.stringify(value)]);
    },
  };
}

export function createMemoryStore() {
  const docs = new Map();
  const hashes = new Map();
  return {
    async get(key) {
      const hit = docs.get(key);
      return hit ? JSON.parse(hit) : null;
    },
    async set(key, value) {
      docs.set(key, JSON.stringify(value));
    },
    async hgetall(key) {
      const h = hashes.get(key) || new Map();
      const out = {};
      for (const [k, v] of h) out[k] = v;
      return out;
    },
    async hset(key, field, value) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key).set(field, JSON.stringify(value));
    },
  };
}

function normalizeLevel(level) {
  const l = String(level || '').trim().toLowerCase();
  if (!LEVELS.includes(l)) throw new Error(`Invalid level: ${level}. Must be one of ${LEVELS.join(', ')}`);
  return l;
}

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function keyFor(level, slug) {
  return `${KEY_PREFIX}:${level}:${slug}`;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Add a new Vault item, or a new version of an existing one. Existing
 * versions are never overwritten — a new version is appended to the
 * item's version history and the "current" pointer moves forward.
 * Matches the epic's rule: never silently overwrite a proven item.
 */
export async function addVaultItem({
  level,
  name,
  purpose,
  when_to_use,
  language,
  framework,
  dependencies = [],
  env_vars = [],
  inputs_outputs,
  source,
  verification,
  security_notes,
  provenance = [],
  lifecycle_status = 'experimental',
  tags = [],
  changelog,
  store = createRedisStore(),
} = {}) {
  const lvl = normalizeLevel(level);
  if (!name || !String(name).trim()) throw new Error('name is required');
  if (!purpose || !String(purpose).trim()) throw new Error('purpose is required');
  if (!LIFECYCLE_STATUSES.includes(lifecycle_status)) {
    throw new Error(`Invalid lifecycle_status: ${lifecycle_status}. Must be one of ${LIFECYCLE_STATUSES.join(', ')}`);
  }

  const slug = slugify(name);
  const key = keyFor(lvl, slug);
  const existing = await store.get(key);

  const versionEntry = {
    version: existing ? existing.versions.length + 1 : 1,
    purpose: String(purpose).trim(),
    when_to_use: when_to_use ? String(when_to_use).trim() : null,
    language: language || null,
    framework: framework || null,
    dependencies,
    env_vars,
    inputs_outputs: inputs_outputs || null,
    source: source || null,
    verification: verification || null,
    security_notes: security_notes || null,
    provenance,
    lifecycle_status,
    changelog: changelog ? String(changelog).trim() : (existing ? 'Updated' : 'Initial version'),
    created_at: Date.now(),
  };

  const record = existing
    ? { ...existing, versions: [...existing.versions, versionEntry], tags: Array.from(new Set([...(existing.tags || []), ...tags])) }
    : { level: lvl, name: String(name).trim(), slug, tags, versions: [versionEntry] };

  record.updated_at = Date.now();
  await store.set(key, record);
  await store.hset(INDEX_KEY, key, { level: lvl, name: record.name, slug, tags: record.tags, updated_at: record.updated_at });

  return { level: lvl, slug, version: versionEntry.version };
}

/**
 * Read the current (latest) version of a Vault item, plus its version
 * count, so a caller knows history exists without fetching it.
 */
export async function getVaultItem({ level, slug, store = createRedisStore() } = {}) {
  const lvl = normalizeLevel(level);
  const record = await store.get(keyFor(lvl, slug));
  if (!record) return null;
  const current = record.versions[record.versions.length - 1];
  return { level: record.level, name: record.name, slug: record.slug, tags: record.tags, current, version_count: record.versions.length };
}

/**
 * Search the Vault before generating something from scratch — keyword/
 * tag overlap scoring, no vector DB needed at this scale. Deprecated
 * items are excluded by default (the epic's explicit "don't reuse
 * this" signal); results rank by match score, then lifecycle maturity
 * (proven > tested > experimental) as a tiebreak.
 */
export async function searchVault({
  query,
  level,
  include_deprecated = false,
  limit = 5,
  store = createRedisStore(),
} = {}) {
  const queryTokens = new Set(tokenize(query));
  const index = await store.hgetall(INDEX_KEY);

  const maturityRank = { proven: 3, tested: 2, experimental: 1, deprecated: 0 };
  const candidates = [];

  for (const raw of Object.values(index)) {
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (level && meta.level !== normalizeLevel(level)) continue;

    const record = await store.get(keyFor(meta.level, meta.slug));
    if (!record) continue;
    const current = record.versions[record.versions.length - 1];
    if (!include_deprecated && current.lifecycle_status === 'deprecated') continue;

    const haystack = new Set([
      ...tokenize(record.name),
      ...tokenize(current.purpose),
      ...tokenize(current.when_to_use),
      ...record.tags.flatMap(tokenize),
    ]);
    const overlap = [...queryTokens].filter((t) => haystack.has(t)).length;
    if (queryTokens.size > 0 && overlap === 0) continue;

    candidates.push({
      level: record.level,
      name: record.name,
      slug: record.slug,
      purpose: current.purpose,
      lifecycle_status: current.lifecycle_status,
      version: current.version,
      score: overlap,
    });
  }

  candidates.sort((a, b) => b.score - a.score || maturityRank[b.lifecycle_status] - maturityRank[a.lifecycle_status]);
  return candidates.slice(0, limit);
}

export async function listVaultItems({ level, store = createRedisStore() } = {}) {
  const index = await store.hgetall(INDEX_KEY);
  const items = Object.values(index).map((raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw));
  return level ? items.filter((i) => i.level === normalizeLevel(level)) : items;
}

export const __internals = { LEVELS, LIFECYCLE_STATUSES };
