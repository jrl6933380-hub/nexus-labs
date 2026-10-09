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
const HISTORY_LIMIT = 30; // recent versions; the current-project index never ages out

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

function cleanStackItem(stackItem, fallback = {}) {
  if (!stackItem || typeof stackItem !== 'object') return null;
  const kind = ['page', 'tool', 'intelligence'].includes(stackItem.kind) ? stackItem.kind : '';
  if (!kind) return null;
  const id = /^[a-zA-Z0-9_-]{1,120}$/.test(String(stackItem.id || ''))
    ? String(stackItem.id)
    : `part-${fallback.id || Date.now()}`;
  const label = String(stackItem.label || fallback.label || `Supporting ${kind}`).trim().slice(0, 80);
  return { id, kind, label: label || `Supporting ${kind}` };
}

function inferredStackItem(build) {
  const message = String(build?.requestMessage || build?.label || '').trim();
  const match = message.match(/^add\b.{0,70}\b(page|portal|dashboard|calculator|workflow|automation|tool|intelligence)\b/i);
  if (!match) return null;
  const word = match[1].toLowerCase();
  const kind = word === 'intelligence' ? 'intelligence' : word === 'page' || word === 'portal' ? 'page' : 'tool';
  return { id: `legacy-${build.id}`, kind, label: message.slice(0, 80) };
}

export async function saveBuild(userId, { label, html, requestMessage, projectId, stackItem, sourceConversation }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id,
    projectId: /^[a-zA-Z0-9_-]{1,120}$/.test(String(projectId || '')) ? String(projectId) : undefined,
    label: (label || requestMessage || 'Untitled build').slice(0, 80),
    requestMessage: requestMessage || '',
    html,
    createdAt: Date.now(),
  };
  if (sourceConversation && ['chat','team'].includes(sourceConversation.kind) && /^[a-zA-Z0-9_-]{1,120}$/.test(String(sourceConversation.id || ''))) entry.sourceConversation = {kind:sourceConversation.kind,id:sourceConversation.id,...(/^[a-zA-Z0-9_-]{1,120}$/.test(String(sourceConversation.runId || ''))?{runId:sourceConversation.runId}:{})};
  const savedStackItem = cleanStackItem(stackItem, { id, label: entry.label });
  if (savedStackItem) entry.stackItem = savedStackItem;
  const key = historyKey(userId);
  await redisCommand(['LPUSH', key, JSON.stringify(entry)]);
  // Backfill every visible project's current version before trimming recent
  // history. Editing one project must never erase another project's only save.
  const recent = await redisCommand(['LRANGE', key, '0', '-1']);
  const indexed = parseEntries(await redisCommand(['HVALS', key + ':current']));
  const previous = new Map(indexed.map(build => [projectKey(build), build]));
  const entries = parseEntries(recent);
  const current = new Map();
  for (const build of entries) {
    const project = projectKey(build);
    if (current.has(project)) continue;
    const versions = entries.filter(item => projectKey(item) === project);
    const prior = previous.get(project);
    const pieces = new Map((prior?.projectStackItems || []).map(item => [item.id, item]));
    for (const version of versions.slice().reverse()) {
      const piece = cleanStackItem(version.stackItem, version) || inferredStackItem(version);
      if (piece) pieces.set(piece.id, {...piece, buildId:version.id, createdAt:version.createdAt});
    }
    current.set(project, {...build, projectMainLabel:prior?.projectMainLabel || versions.at(-1)?.label || build.label, projectStackItems:[...pieces.values()], sourceConversation:build.sourceConversation || prior?.sourceConversation || versions.find(item => item.sourceConversation)?.sourceConversation});
  }
  if (current.size) await redisCommand(['HSET', key + ':current', ...[...current].flatMap(([project, build]) => [project, JSON.stringify(build)])]);
  await redisCommand(['LTRIM', key, '0', String(HISTORY_LIMIT - 1)]);
  return entry;
}

// Lightweight list for the history panel — strips the (potentially
// large) html field so scanning past builds stays cheap.
export async function listBuilds(userId) {
  return (await historyEntries(userId)).map(({ id, projectId, label, requestMessage, createdAt, stackItem, sourceConversation, projectMainLabel, projectStackItems }) => ({ id, projectId, label, requestMessage, createdAt, stackItem, sourceConversation, projectMainLabel, projectStackItems }));
}

// Groups saved builds into PROJECTS — one row per project, not one per
// save. Every edit calls saveBuild, so a project someone has edited ten
// times had ten entries in the flat list and looked like ten separate
// projects. This collapses them: the newest save is the project's current
// state, and the rest are its version history.
//
// Recent versions are bounded; the current-project index preserves every
// project's latest page, original title, conversation link and supporting pieces.
export async function listProjects(userId) {
  const builds = await listBuilds(userId);
  const byProject = new Map();
  const knownProjects=new Set(builds.map(build=>build.projectId).filter(Boolean));
  for (const build of builds) {
    // A save from before projects existed has no projectId; treat it as
    // its own standalone project keyed by its build id so it stays visible.
    const key = build.projectId || (knownProjects.has(build.id)?build.id:`build:${build.id}`);
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
        builds: [build],
        sourceConversation: build.sourceConversation,
        projectMainLabel:build.projectMainLabel, projectStackItems:build.projectStackItems || [],
      });
      continue;
    }
    // listBuilds is newest-first, so the first entry seen is the current
    // one; later entries only extend the history.
    existing.versionCount += 1;
    existing.createdAt = Math.min(existing.createdAt, build.createdAt);
    existing.builds.push(build);
  }
  return [...byProject.values()].map((project) => {
    const oldest = project.builds[project.builds.length - 1];
    const seen = new Set(project.projectStackItems.map(item=>item.id));
    const stackItems = [...project.projectStackItems];
    for (const build of project.builds.slice(0, -1).reverse()) {
      const item = cleanStackItem(build.stackItem, { id: build.id, label: build.label }) || inferredStackItem(build);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      stackItems.push({ ...item, buildId: build.id, createdAt: build.createdAt });
    }
    const { builds: _builds, projectMainLabel, projectStackItems:_pieces, ...summary } = project;
    return { ...summary, mainLabel: projectMainLabel || oldest?.label || project.label, stackItems };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

// Removes every saved version of one project. Irreversible: the builds are
// the only copy. Returns how many versions were removed.
export async function deleteProject(userId, projectId) {
  if (!projectId) throw new Error('projectId is required');
  const key = historyKey(userId);
  const [recent,indexed]=await Promise.all([redisCommand(['LRANGE',key,'0','-1']),redisCommand(['HVALS',key+':current'])]);
  const recentIds=new Set(parseEntries(recent).map(entry=>entry.id));
  const raw=[...(Array.isArray(recent)?recent:[]),...(Array.isArray(indexed)?indexed:[]).filter(value=>{try{const entry=JSON.parse(value);return !recentIds.has(entry?.id);}catch{return !(recent || []).includes(value);}})];
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
    if(!parsed || typeof parsed!=='object'){keep.push(entry);continue;}
    const entryKey = parsed.projectId || `build:${parsed.id}`;
    if (entryKey === projectId || (!parsed.projectId && parsed.id===projectId)) removed += 1;
    else keep.push(entry);
  }
  if (removed === 0) return { removed: 0 };
  // Rewrite the list in its original newest-first order. DEL then RPUSH
  // rather than repeated LREM so one pass can't leave a half-deleted
  // project behind.
  await redisCommand(['HDEL', key + ':current', projectId, `build:${projectId}`]);
  await redisCommand(['DEL', key]);
  if (keep.length > 0) await redisCommand(['RPUSH', key, ...keep]);
  return { removed };
}

export async function getBuild(userId, id) {
  const raw = (await historyEntries(userId)).map(entry=>JSON.stringify(entry));
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
  const raw = (await historyEntries(userId)).map(entry=>JSON.stringify(entry));
  if (!raw || !Array.isArray(raw)) return null;
  for (const r of raw) {
    try {
      const entry = JSON.parse(r);
      if (entry.projectId === projectId || (!entry.projectId && (entry.id===projectId || `build:${entry.id}`===projectId))) return entry;
    } catch {
      // skip a malformed entry rather than crashing the lookup
    }
  }
  return null;
}

function projectKey(build){return build.projectId || `build:${build.id}`;}
function parseEntries(raw){return (Array.isArray(raw)?raw:[]).flatMap(value=>{try{const entry=JSON.parse(value);return entry && typeof entry==='object' && typeof entry.id==='string'?[entry]:[];}catch{return [];}});}
async function historyEntries(userId){
  const key=historyKey(userId);
  const [recent,indexed]=await Promise.all([redisCommand(['LRANGE',key,'0',String(HISTORY_LIMIT-1)]),redisCommand(['HVALS',key+':current'])]);
  const old=new Map(parseEntries(indexed).map(build=>[build.id,build]));const entries=new Map();for(const build of parseEntries(recent))entries.set(build.id,{...old.get(build.id),...build});for(const build of old.values())if(!entries.has(build.id))entries.set(build.id,build);
  return [...entries.values()].sort((a,b)=>b.createdAt-a.createdAt);
}
