// /lib/systemSnapshot.js
// Compact, freshness-checked system context. GitHub/Redis/Vercel remain authoritative.

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const SNAPSHOT_KEY = 'nexus:system:snapshot';
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export function createSystemSnapshot(input = {}) {
  const now = input.generated_at || Date.now();
  return {
    schema_version: 1,
    snapshot_id: input.snapshot_id || `snapshot-${now}-${Math.random().toString(36).slice(2, 8)}`,
    generated_at: now,
    source: { repository: input.repository || null, branch: input.branch || null, commit_sha: input.commit_sha || null },
    project: input.project || {},
    repositories: input.repositories || [],
    capabilities: (input.capabilities || []).map(({ name, access = 'read', approval = 'not_required' }) => ({ name, access, approval })),
    architecture: input.architecture || {},
    verification: input.verification || {},
    freshness: { ttl_ms: input.ttl_ms || DEFAULT_TTL_MS, refresh_sections: input.refresh_sections || ['source', 'project', 'verification'] },
  };
}

export function snapshotStaleness(snapshot, { now = Date.now(), current_commit_sha = null, requested_paths = [] } = {}) {
  if (!snapshot) return { stale: true, reasons: ['missing'] };
  const reasons = [];
  const ttl = snapshot.freshness?.ttl_ms || DEFAULT_TTL_MS;
  if (now - (snapshot.generated_at || 0) > ttl) reasons.push('expired');
  if (current_commit_sha && snapshot.source?.commit_sha && current_commit_sha !== snapshot.source.commit_sha) reasons.push('source_changed');
  const knownPaths = new Set(snapshot.project?.files_touched || []);
  if (requested_paths.some((path) => knownPaths.size && !knownPaths.has(path))) reasons.push('scope_mismatch');
  return { stale: reasons.length > 0, reasons };
}

export function selectSnapshotContext(snapshot, sections = []) {
  if (!snapshot) return {};
  if (!sections.length) return snapshot;
  return Object.fromEntries(sections.filter((section) => Object.hasOwn(snapshot, section)).map((section) => [section, snapshot[section]]));
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Snapshot Redis command ${command[0]} failed`);
  return data.result;
}

export async function saveSystemSnapshot(input) {
  const snapshot = createSystemSnapshot(input);
  await redisCommand(['SET', SNAPSHOT_KEY, JSON.stringify(snapshot)]);
  return snapshot;
}

export async function loadSystemSnapshot() {
  const raw = await redisCommand(['GET', SNAPSHOT_KEY]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function loadFreshSnapshot(options = {}) {
  const snapshot = await loadSystemSnapshot();
  const freshness = snapshotStaleness(snapshot, options);
  return { snapshot: freshness.stale ? null : snapshot, stale: freshness.stale, reasons: freshness.reasons };
}
