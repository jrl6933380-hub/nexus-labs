// /lib/systemSnapshot.js
// Pure snapshot helpers. They keep the fast context layer small and verifiable;
// external adapters can persist the returned objects in Redis or a cache.

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function createSystemSnapshot(input = {}) {
  const now = input.generated_at || Date.now();
  return {
    schema_version: 1,
    snapshot_id: input.snapshot_id || `snapshot-${now}-${Math.random().toString(36).slice(2, 8)}`,
    generated_at: now,
    source: {
      repository: input.repository || null,
      branch: input.branch || null,
      commit_sha: input.commit_sha || null,
    },
    project: input.project || {},
    repositories: input.repositories || [],
    capabilities: (input.capabilities || []).map(({ name, access = 'read', approval = 'not_required' }) => ({ name, access, approval })),
    architecture: input.architecture || {},
    verification: input.verification || {},
    freshness: {
      ttl_ms: input.ttl_ms || DEFAULT_TTL_MS,
      refresh_sections: input.refresh_sections || ['source', 'project', 'verification'],
    },
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
