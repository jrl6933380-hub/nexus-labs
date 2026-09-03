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

export async function saveBuild(userId, { label, html, requestMessage }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    .map(({ id, label, requestMessage, createdAt }) => ({ id, label, requestMessage, createdAt }));
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
