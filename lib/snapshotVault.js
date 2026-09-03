// /lib/snapshotVault.js
// Versioned snapshot vault. Stores compact metadata only; GitHub/Redis/Vercel remain authoritative.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const VAULT_KEY = 'nexus:system:snapshot:vault';
const MAX_VERSIONS = 20;

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Snapshot vault Redis command ${command[0]} failed`);
  return data.result;
}

function safeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Snapshot must be an object');
  return JSON.parse(JSON.stringify(snapshot));
}

async function readVault() {
  const raw = await redisCommand(['GET', VAULT_KEY]);
  if (!raw) return [];
  try {
    const versions = JSON.parse(raw);
    return Array.isArray(versions) ? versions : [];
  } catch {
    return [];
  }
}

export async function saveSnapshotVersion(snapshot, label = 'default') {
  const clean = safeSnapshot(snapshot);
  const version = {
    version_id: `sv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: String(label).slice(0, 80),
    saved_at: Date.now(),
    source_commit_sha: clean.source?.commit_sha || null,
    snapshot: clean,
  };
  const versions = [version, ...(await readVault())].slice(0, MAX_VERSIONS);
  await redisCommand(['SET', VAULT_KEY, JSON.stringify(versions)]);
  return version;
}

export async function listSnapshotVersions(label = null) {
  const versions = await readVault();
  return versions
    .filter((version) => !label || version.label === label)
    .map(({ version_id, label: versionLabel, saved_at, source_commit_sha, snapshot }) => ({
      version_id, label: versionLabel, saved_at, source_commit_sha,
      snapshot_id: snapshot?.snapshot_id || null,
    }));
}

export async function restoreSnapshotVersion(version_id) {
  const version = (await readVault()).find((candidate) => candidate.version_id === version_id);
  if (!version) throw new Error('Snapshot version not found');
  return version.snapshot;
}
