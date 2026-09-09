// lib/roomAuth.js
// Minimal accounts for the live-canvas room, so a test group can each
// have their own login and their own private build history instead of
// sharing one global list. Deliberately lightweight: no new npm
// dependencies (password hashing via Node's built-in crypto.scrypt,
// same as the rest of this repo avoids adding auth libraries), same
// raw-Redis-REST pattern as lib/board.js / lib/roomHistory.js.
//
// Signup is gated by a shared invite code (process.env.ROOM_INVITE_CODE)
// rather than being open registration — appropriate for a small test
// group, not a public product yet. If that env var isn't set, signup
// is disabled entirely rather than silently open.

import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const USERS_KEY = 'nexus:room:users';
const SESSION_PREFIX = 'nexus:room:sessions:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const SESSION_COOKIE = 'nexus_room_session';

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('roomAuth redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function isValidUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(username);
}

export async function createUser(username, password, inviteCode) {
  const expectedInvite = process.env.ROOM_INVITE_CODE;
  if (!expectedInvite) {
    throw new Error('Signups are not currently open for this room.');
  }
  if (inviteCode !== expectedInvite) {
    throw new Error('That invite code is not valid.');
  }
  if (!isValidUsername(username)) {
    throw new Error('Username must be 3-32 characters: letters, numbers, underscore, or dash.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const existing = await redisCommand(['HGET', USERS_KEY, username]);
  if (existing) {
    throw new Error('That username is already taken.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  // The pre-check above is only a fast rejection. Another signup can
  // arrive before this write, so creation itself must be atomic and
  // must never replace credentials attached to existing history/usage.
  const created = await redisCommand([
    'HSETNX',
    USERS_KEY,
    username,
    JSON.stringify({ salt, passwordHash, createdAt: Date.now() }),
  ]);
  if (created === 0) throw new Error('That username is already taken.');
  if (created !== 1) throw new Error('Could not create account. Try again.');
  return { username };
}

export async function verifyUser(username, password) {
  if (!isValidUsername(username)) return null;
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  const attemptHash = hashPassword(password, record.salt);
  const a = Buffer.from(attemptHash, 'hex');
  const b = Buffer.from(record.passwordHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { username };
}

export async function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  await redisCommand(['SET', SESSION_PREFIX + token, username, 'EX', String(SESSION_TTL_SECONDS)]);
  return token;
}

export async function getSessionUser(token) {
  if (!token) return null;
  const username = await redisCommand(['GET', SESSION_PREFIX + token]);
  return username || null;
}

export async function destroySession(token) {
  if (!token) return;
  await redisCommand(['DEL', SESSION_PREFIX + token]);
}

// ---- Cookie helpers (no framework — plain Vercel Node functions) ----

export function parseCookies(req) {
  const header = req.headers?.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function serializeSessionCookie(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : SESSION_TTL_SECONDS;
  const value = clear ? '' : encodeURIComponent(token);
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// Reads the session cookie off a request and resolves it to a
// username, or null if there's no valid session. Use at the top of
// any room-* endpoint that should require login.
export async function getRequestUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return getSessionUser(token);
}
