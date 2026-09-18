// Private owner authentication for the Nexus launch station.
//
// This is intentionally separate from lib/roomAuth.js. Forge accounts are
// customer/product identities; a Forge login must never grant access to Nex,
// owner memory, ventures, or the Nexus command dashboard.

import crypto from 'node:crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CREDENTIAL_KEY = 'nexus:owner:credential:v1';
const SESSION_PREFIX = 'nexus:owner:sessions:';
const SETUP_TICKET_PREFIX = 'nexus:owner:setup-tickets:';
const LOGIN_ATTEMPT_PREFIX = 'nexus:owner:login-attempts:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SETUP_TICKET_TTL_SECONDS = 15 * 60;
const LOGIN_WINDOW_SECONDS = 10 * 60;
const MAX_LOGIN_ATTEMPTS = 8;

export const NEXUS_OWNER_COOKIE = 'nexus_owner_session';

function ownerId() {
  const configured = String(process.env.NEXUS_OWNER_ID || 'justin').trim().toLowerCase();
  return /^[a-z0-9_-]{3,32}$/u.test(configured) ? configured : 'justin';
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Nexus owner Redis ${command[0]} failed`);
  return data.result;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Your Nexus password must be at least 12 characters.');
  }
  if (password.length > 256) throw new Error('Your Nexus password is too long.');
}

export async function ownerPasswordIsSet() {
  return Boolean(await redisCommand(['GET', CREDENTIAL_KEY]));
}

// Called only by a server-to-server request carrying NEXUS_AGENT_API_TOKEN.
// The returned raw ticket lives for 15 minutes and is never stored in Redis;
// only its SHA-256 digest is stored. It can initialize or intentionally reset
// the owner password without involving a Forge identity.
export async function issueOwnerSetupTicket() {
  const ticket = crypto.randomBytes(32).toString('base64url');
  const mode = await ownerPasswordIsSet() ? 'reset' : 'setup';
  const record = JSON.stringify({ mode, issuedAt: Date.now() });
  await redisCommand(['SET', SETUP_TICKET_PREFIX + digest(ticket), record, 'EX', String(SETUP_TICKET_TTL_SECONDS)]);
  return { ticket, mode, expiresIn: SETUP_TICKET_TTL_SECONDS };
}

export async function setOwnerPasswordWithTicket(ticket, password) {
  validatePassword(password);
  if (typeof ticket !== 'string' || ticket.length < 32) throw new Error('This setup link is invalid or expired.');
  const ticketKey = SETUP_TICKET_PREFIX + digest(ticket);
  // GETDEL makes the ticket single-use even when two setup requests race.
  const rawTicket = await redisCommand(['GETDEL', ticketKey]);
  if (!rawTicket) throw new Error('This setup link is invalid or expired.');

  let ticketRecord;
  try { ticketRecord = JSON.parse(rawTicket); } catch { throw new Error('This setup link is invalid or expired.'); }
  const salt = crypto.randomBytes(16).toString('hex');
  const credential = JSON.stringify({
    ownerId: ownerId(),
    salt,
    passwordHash: hashPassword(password, salt),
    updatedAt: Date.now(),
  });

  if (ticketRecord.mode === 'setup') {
    const created = await redisCommand(['SET', CREDENTIAL_KEY, credential, 'NX']);
    if (created !== 'OK') throw new Error('The Nexus owner password has already been created.');
  } else if (ticketRecord.mode === 'reset') {
    await redisCommand(['SET', CREDENTIAL_KEY, credential]);
    await revokeAllOwnerSessions();
  } else {
    throw new Error('This setup link is invalid or expired.');
  }

  return { id: ownerId() };
}

export async function verifyOwnerPassword(password) {
  const raw = await redisCommand(['GET', CREDENTIAL_KEY]);
  if (!raw || typeof password !== 'string') return null;
  let credential;
  try { credential = JSON.parse(raw); } catch { return null; }
  const attempt = hashPassword(password, credential.salt);
  if (!safeHashEqual(attempt, credential.passwordHash)) return null;
  return { id: credential.ownerId || ownerId() };
}

export async function createOwnerSession() {
  const token = crypto.randomBytes(32).toString('hex');
  await redisCommand(['SET', SESSION_PREFIX + token, ownerId(), 'EX', String(SESSION_TTL_SECONDS)]);
  return token;
}

export async function destroyOwnerSession(token) {
  if (token) await redisCommand(['DEL', SESSION_PREFIX + token]);
}

export async function revokeAllOwnerSessions() {
  const keys = await redisCommand(['KEYS', SESSION_PREFIX + '*']);
  if (!Array.isArray(keys)) return;
  for (const key of keys) await redisCommand(['DEL', key]);
}

export function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key) cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function serializeOwnerCookie(token, { clear = false } = {}) {
  const value = clear ? '' : encodeURIComponent(token);
  return `${NEXUS_OWNER_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_TTL_SECONDS}`;
}

export async function getNexusOwner(req) {
  const token = parseCookies(req)[NEXUS_OWNER_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/u.test(token)) return null;
  const id = await redisCommand(['GET', SESSION_PREFIX + token]);
  return id ? { id } : null;
}

export async function consumeOwnerLoginAttempt(identity) {
  const key = LOGIN_ATTEMPT_PREFIX + digest(identity || 'unknown');
  const attempts = Number(await redisCommand(['INCR', key]));
  if (attempts === 1) await redisCommand(['EXPIRE', key, String(LOGIN_WINDOW_SECONDS)]);
  return attempts <= MAX_LOGIN_ATTEMPTS;
}

export async function clearOwnerLoginAttempts(identity) {
  await redisCommand(['DEL', LOGIN_ATTEMPT_PREFIX + digest(identity || 'unknown')]);
}
