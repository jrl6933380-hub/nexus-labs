// lib/forgeRoles.js
// Minimal role gate for Nexus Forge's sales workbench. Deliberately
// reuses the existing roomAuth users hash (same pattern as `plan` on
// the user record — see setUserPlan) instead of a new store, so there
// is exactly one place a username's account state lives.
//
// This is intentionally the simplest thing that unblocks a real
// caller today: two roles, no territories/campaigns/permission matrix
// yet. Nex's design notes call for a fuller permission matrix before
// the rest of the MVP (scraping, site-gen, embedded telephony) — this
// file is the seed to build that out from, not the final model.

import { isOperatorUser } from './roomAuth.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const USERS_KEY = 'nexus:room:users';

export const FORGE_ROLES = Object.freeze({
  WORKER: 'forge_worker',
  MANAGER: 'forge_manager',
});
const KNOWN_ROLES = new Set(Object.values(FORGE_ROLES));

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('forgeRoles redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

async function getUserRecord(username) {
  if (!username) return null;
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getForgeRole(username) {
  if (!username) return null;
  if (isOperatorUser(username)) return FORGE_ROLES.MANAGER;
  const record = await getUserRecord(username);
  return record && KNOWN_ROLES.has(record.forgeRole) ? record.forgeRole : null;
}

export async function isForgeManager(username) {
  return (await getForgeRole(username)) === FORGE_ROLES.MANAGER;
}

// Managers can also work leads themselves.
export async function isForgeWorker(username) {
  const role = await getForgeRole(username);
  return role === FORGE_ROLES.WORKER || role === FORGE_ROLES.MANAGER;
}

// Manager-only in practice (enforced by callers). Promotes/demotes a
// username. There's no UI for this yet in the MVP — call it once from
// a script or a temporary admin endpoint to seat the first
// manager/worker, the same bootstrap gap roomAuth's
// NEXUS_OPERATOR_USERNAMES has today.
export async function setForgeRole(username, role) {
  if (!username) throw new Error('Username required.');
  if (role !== null && !KNOWN_ROLES.has(role)) throw new Error(`Unknown forge role: ${role}`);
  const record = await getUserRecord(username);
  if (!record) throw new Error('No such user.');
  if (role === null) delete record.forgeRole;
  else record.forgeRole = role;
  await redisCommand(['HSET', USERS_KEY, username, JSON.stringify(record)]);
  return { username, role };
}
