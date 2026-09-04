/**
 * Room Build Checkpoints (stage 1)
 * --------------------------------
 * Implementation notes:
 * - Idempotent, versioned writes via monotonically increasing version counters stored alongside checkpoint records.
 * - TTL-backed storage. Every successful touch extends TTL.
 * - Redaction + untrusted envelope: this module stores/returns only checkpoint state; it does not interpret HTML.
 * - Uses artifact references instead of large HTML blobs.
 */

import crypto from 'crypto';

const CHECKPOINT_NAMESPACE = 'room:checkpoints';

function nowMs() {
  return Date.now();
}

function defaultTtlMs() {
  // 30 days default TTL (matches Hyperfocus pattern).
  return 30 * 24 * 60 * 60 * 1000;
}

function stableIdFromKey(idempotencyKey, tenantId, projectId) {
  const h = crypto.createHash('sha256');
  h.update(String(tenantId));
  h.update('|');
  h.update(String(projectId));
  h.update('|');
  h.update(String(idempotencyKey));
  return h.digest('hex');
}

function assertNonEmptyString(name, v) {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertSameScope(checkpointTenantId, checkpointProjectId, tenantId, projectId) {
  if (checkpointTenantId !== tenantId || checkpointProjectId !== projectId) {
    throw new Error('checkpoint scope mismatch');
  }
}

/**
 * Artifact reference schema (kept intentionally small):
 * - { kind: 'room-html-artifact' | 'room-canvas-artifact' | 'other', ref: string, sizeHint?: number }
 */
function normalizeArtifactRef(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  if (typeof artifact.kind !== 'string' || typeof artifact.ref !== 'string') return null;
  const out = {
    kind: artifact.kind,
    ref: artifact.ref,
  };
  if (typeof artifact.sizeHint === 'number') out.sizeHint = artifact.sizeHint;
  return out;
}

function sanitizeCheckpointState(input) {
  // Redact: never persist raw HTML strings.
  // We accept only artifact references and small structured JSON.
  const state = input ?? {};

  const { sectionsBuilt = [], planRemaining = null, decisions = {}, artifacts = [] } = state;

  const safeSections = Array.isArray(sectionsBuilt)
    ? sectionsBuilt
        .slice(0, 500)
        .map((s) => {
          if (!s || typeof s !== 'object') return null;
          const { sectionId, artifactRef } = s;
          return {
            sectionId: typeof sectionId === 'string' ? sectionId : null,
            artifactRef: normalizeArtifactRef(artifactRef),
          };
        })
        .filter(Boolean)
    : [];

  const safePlan = planRemaining && typeof planRemaining === 'object' ? planRemaining : null;

  const safeDecisions =
    decisions && typeof decisions === 'object'
      ? Object.fromEntries(
          Object.entries(decisions)
            .filter(([k]) => typeof k === 'string')
            .slice(0, 200)
            .map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null ? v : null])
        )
      : {};

  const safeArtifacts = Array.isArray(artifacts)
    ? artifacts
        .slice(0, 500)
        .map((a) => normalizeArtifactRef(a))
        .filter(Boolean)
    : [];

  return {
    sectionsBuilt: safeSections,
    planRemaining: safePlan,
    decisions: safeDecisions,
    artifacts: safeArtifacts,
  };
}

// ---- Persistence adapters -------------------------------------------------
// This repo already has Redis-backed TTL patterns in hyperfocus/system snapshots.
// We keep this module adapter-free in stage 1: it expects a KV interface injected
// by the caller (api layer). That keeps token/credential boundaries out of lib.

/**
 * @typedef {object} CheckpointKV
 * @property {(key:string)=>Promise<any>} get
 * @property {(key:string,value:any,opts:{ttlMs:number})=>Promise<void>} set
 */

function makeRecordKey(id) {
  return `${CHECKPOINT_NAMESPACE}:${id}`;
}

function makeVersionKey(id) {
  return `${CHECKPOINT_NAMESPACE}:${id}:version`;
}

function makeTtlTouchKey(id) {
  return `${CHECKPOINT_NAMESPACE}:${id}:touch`;
}

/**
 * Create or update a checkpoint with idempotency + versioning.
 *
 * @param {object} params
 * @param {CheckpointKV} params.kv - injected KV with get/set
 * @param {string} params.tenantId
 * @param {string} params.projectId
 * @param {string} params.idempotencyKey
 * @param {number} params.ifVersion - optimistic concurrency (required)
 * @param {object} params.state - checkpoint state (artifact refs only)
 * @param {number} [params.ttlMs]
 */
export async function upsertRoomCheckpoint({
  kv,
  tenantId,
  projectId,
  idempotencyKey,
  ifVersion,
  state,
  ttlMs = defaultTtlMs(),
}) {
  assertNonEmptyString('tenantId', tenantId);
  assertNonEmptyString('projectId', projectId);
  assertNonEmptyString('idempotencyKey', idempotencyKey);
  if (!Number.isInteger(ifVersion) || ifVersion < 0) {
    throw new Error('ifVersion must be a non-negative integer');
  }

  if (!kv || typeof kv.get !== 'function' || typeof kv.set !== 'function') {
    throw new Error('kv adapter required');
  }

  const checkpointId = stableIdFromKey(idempotencyKey, tenantId, projectId);
  const key = makeRecordKey(checkpointId);

  const existing = await kv.get(key);
  const existingVersion = existing?.version;

  const recordTenantId = existing?.tenantId;
  const recordProjectId = existing?.projectId;

  if (existing) {
    assertSameScope(recordTenantId, recordProjectId, tenantId, projectId);
    if (existingVersion !== ifVersion) {
      const e = new Error('checkpoint version conflict');
      e.code = 'IF_VERSION_FAILED';
      throw e;
    }
  } else {
    // If no record exists, only allow ifVersion=0.
    if (ifVersion !== 0) {
      const e = new Error('checkpoint missing for requested ifVersion');
      e.code = 'IF_VERSION_FAILED';
      throw e;
    }
  }

  const sanitizedState = sanitizeCheckpointState(state);

  const nextVersion = (existingVersion ?? 0) + 1;
  const record = {
    tenantId,
    projectId,
    checkpointId,
    idempotencyKey,
    version: nextVersion,
    state: sanitizedState,
    updatedAtMs: nowMs(),
  };

  // Touch TTL by writing the record back with ttlMs.
  await kv.set(key, record, { ttlMs });
  return { checkpointId, version: nextVersion, updatedAtMs: record.updatedAtMs };
}

/**
 * Read a checkpoint.
 * Returns an untrusted envelope (caller responsibility for display).
 */
export async function getRoomCheckpoint({ kv, tenantId, projectId, idempotencyKey }) {
  assertNonEmptyString('tenantId', tenantId);
  assertNonEmptyString('projectId', projectId);
  assertNonEmptyString('idempotencyKey', idempotencyKey);
  if (!kv || typeof kv.get !== 'function') {
    throw new Error('kv adapter required');
  }

  const checkpointId = stableIdFromKey(idempotencyKey, tenantId, projectId);
  const key = makeRecordKey(checkpointId);

  const existing = await kv.get(key);
  if (!existing) return null;
  assertSameScope(existing.tenantId, existing.projectId, tenantId, projectId);

  return {
    untrusted: true,
    checkpoint: {
      checkpointId: existing.checkpointId,
      version: existing.version,
      updatedAtMs: existing.updatedAtMs,
      state: existing.state,
    },
  };
}

/**
 * Touch/checkpoint TTL renewal.
 */
export async function touchRoomCheckpoint({ kv, tenantId, projectId, idempotencyKey, ttlMs = defaultTtlMs() }) {
  assertNonEmptyString('tenantId', tenantId);
  assertNonEmptyString('projectId', projectId);
  assertNonEmptyString('idempotencyKey', idempotencyKey);
  if (!kv || typeof kv.get !== 'function' || typeof kv.set !== 'function') {
    throw new Error('kv adapter required');
  }

  const checkpointId = stableIdFromKey(idempotencyKey, tenantId, projectId);
  const key = makeRecordKey(checkpointId);

  const existing = await kv.get(key);
  if (!existing) return null;
  assertSameScope(existing.tenantId, existing.projectId, tenantId, projectId);

  // Re-set same record for TTL touch.
  const record = { ...existing, updatedAtMs: nowMs() };
  await kv.set(key, record, { ttlMs });

  return { checkpointId, version: record.version, updatedAtMs: record.updatedAtMs };
}
