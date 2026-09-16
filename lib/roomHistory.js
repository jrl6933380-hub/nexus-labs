// lib/roomHistory.js
// Persists successful live-canvas room builds so a page isn't lost the
// moment the browser tab closes or refreshes. Same raw-Redis-REST
// pattern as lib/board.js, reusing the existing KV_REST_API_URL /
// KV_REST_API_TOKEN — no new env vars, no new infrastructure.
//
// Scoped per-user (see lib/roomAuth.js): each account gets its own
// history list, key nexus:room:builds:<username>, so a test group can
// use the room without seeing each other's builds. The old shared key
// (nexus:room:builds, no suffix) from before accounts existed is left
// in place untouched — not migrated, just no longer read or written by
// this module.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const HISTORY_LIMIT = 30; // keep the most recent 30 builds per user

function historyKey(userId) {
  return `nexus:room:builds:${userId}`;
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
    console.error('roomHistory redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export async function saveBuild(userId, { label, html, requestMessage, projectId }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: /^[a-zA-Z0-9_-]{1,120}$/.test(String(projectId || '')) ? String(projectId) : undefined,
    label: (label || requestMessage || 'Untitled build').slice(0, 80),
    requestMessage: requestMessage || '',
    html,
    createdAt: Date.now(),
  };
  const key = historyKey(userId);
  await redisCommand(['LPUSH', key, JSON.stringify(entry)]);
  await redisCommand(['LTRIM', key, '0', String(HISTORY_LIMIT - 1)]);
  return entry;
}

// Lightweight list for the history panel — strips the (potentially
// large) html field so scanning past builds stays cheap.
export async function listBuilds(userId) {
  const raw = await redisCommand(['LRANGE', historyKey(userId), '0', String(HISTORY_LIMIT - 1)]);
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      try {
        return JSON.parse(r);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map(({ id, projectId, label, requestMessage, createdAt }) => ({ id, projectId, label, requestMessage, createdAt }));
}

// Groups saved builds into PROJECTS — one row per project, not one per
// save. Every edit calls saveBuild, so a project someone has edited ten
// times had ten entries in the flat list and looked like ten separate
// projects. This collapses them: the newest save is the project's current
// state, and the rest are its version history.
//
// Note the HISTORY_LIMIT interaction: the underlying list still holds the
// most recent 30 SAVES across all projects, so heavy editing on one project
// can still age out an older project's only save. Grouping makes that
// visible (versionCount) rather than fixing it; a per-project cap would be
// the real fix if it starts biting.
export async function listProjects(userId) {
  const builds = await listBuilds(userId);
  const byProject = new Map();
  for (const build of builds) {
    // A save from before projects existed has no projectId; treat it as
    // its own standalone project keyed by its build id so it stays visible.
    const key = build.projectId || `build:${build.id}`;
    const existing = byProject.get(key);
    if (!existing) {
      byProject.set(key, {
        key,
        projectId: build.projectId || null,
        latestBuildId: build.id,
        label: build.label,
        updatedAt: build.createdAt,
        createdAt: build.createdAt,
        versionCount: 1,
      });
      continue;
    }
    // listBuilds is newest-first, so the first entry seen is the current
    // one; later entries only extend the history.
    existing.versionCount += 1;
    existing.createdAt = Math.min(existing.createdAt, build.createdAt);
  }
  return [...byProject.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

// Removes every saved version of one project. Irreversible: the builds are
// the only copy. Returns how many versions were removed.
export async function deleteProject(userId, projectId) {
  if (!projectId) throw new Error('projectId is required');
  const key = historyKey(userId);
  const raw = await redisCommand(['LRANGE', key, '0', String(HISTORY_LIMIT - 1)]);
  if (!raw || !Array.isArray(raw) || raw.length === 0) return { removed: 0 };
  const keep = [];
  let removed = 0;
  for (const entry of raw) {
    let parsed = null;
    try {
      parsed = JSON.parse(entry);
    } catch {
      keep.push(entry); // never drop something we couldn't read
      continue;
    }
    const entryKey = parsed.projectId || `build:${parsed.id}`;
    if (entryKey === projectId) removed += 1;
    else keep.push(entry);
  }
  if (removed === 0) return { removed: 0 };
  // Rewrite the list in its original newest-first order. DEL then RPUSH
  // rather than repeated LREM so one pass can't leave a half-deleted
  // project behind.
  await redisCommand(['DEL', key]);
  if (keep.length > 0) await redisCommand(['RPUSH', key, ...keep]);
  return { removed };
}

export async function getBuild(userId, id) {
  const raw = await redisCommand(['LRANGE', historyKey(userId), '0', String(HISTORY_LIMIT - 1)]);
  if (!raw || !Array.isArray(raw)) return null;
  for (const r of raw) {
    try {
      const entry = JSON.parse(r);
      if (entry.id === id) return entry;
    } catch {
      // skip a malformed entry rather than crashing the lookup
    }
  }
  return null;
}

// Used by the Site Agent widget (api/site-agent-chat.js), which only
// knows a projectId, not any specific saved-build id — returns the
// most recent save for that project (LPUSH keeps newest first) so the
// embedded assistant answers from the current version of the site.
export async function getLatestBuildByProject(userId, projectId) {
  const raw = await redisCommand(['LRANGE', historyKey(userId), '0', String(HISTORY_LIMIT - 1)]);
  if (!raw || !Array.isArray(raw)) return null;
  for (const r of raw) {
    try {
      const entry = JSON.parse(r);
      if (entry.projectId === projectId) return entry;
    } catch {
      // skip a malformed entry rather than crashing the lookup
    }
  }
  return null;
}
