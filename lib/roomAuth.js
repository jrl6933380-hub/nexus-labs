// lib/roomAuth.js
// Minimal accounts for the live-canvas room, so a test group can each
// have their own login and their own private build history instead of
// sharing one global list. Deliberately lightweight: no new npm
// dependencies (password hashing via Node's built-in crypto.scrypt,
// same as the rest of this repo avoids adding auth libraries), same
// raw-Redis-REST pattern as lib/board.js / lib/roomHistory.js.
//
// Signup is open registration — paid Nexus Forge tiers need to be
// purchasable by anyone, so this is no longer gated by an invite code
// (previously process.env.ROOM_INVITE_CODE).

import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const USERS_KEY = 'nexus:room:users';
const SESSION_PREFIX = 'nexus:room:sessions:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const SESSION_COOKIE = 'nexus_room_session';

// Reverse index: Stripe Customer id -> username. Populated the first
// time a subscription checkout completes (see api/webhooks/stripe.js),
// so a later cancellation event — which only carries the customer id,
// not any Nexus-specific metadata — can still be traced back to an
// account and downgraded to Free.
const STRIPE_CUSTOMERS_KEY = 'nexus:room:stripe-customers';

// Plan tiers, stored on the user record (see createUser). No billing
// wired yet — plan is set manually (e.g. by Justin, or a future Stripe
// webhook) via setUserPlan. Anyone without a stored plan defaults to
// free, so this is safe to introduce without a backfill.
export const PLANS = Object.freeze({
  FREE: 'free',
  HOSTED: 'hosted',
  GROWTH: 'growth',
  UNLIMITED: 'unlimited',
});
const KNOWN_PLANS = new Set(Object.values(PLANS));

// Operator access is resolved only on the server. Keep the allowlist in an
// environment variable for hosted installs; Mrlopez remains the owner account
// for this existing Nexus deployment when the variable has not been set yet.
// Comparisons are case-insensitive so login casing cannot silently remove the
// dock, while customers never receive operator status from client input.
export function isOperatorUser(username) {
  if (typeof username !== 'string' || !username.trim()) return false;
  const configured = process.env.NEXUS_OPERATOR_USERNAMES || 'Mrlopez';
  const operators = configured
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return operators.includes(username.trim().toLowerCase());
}

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

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Reusable answer verification, offered as a free (no email needed)
// alternative identity check for password resets — answers are
// normalized (trim + lowercase) before hashing so casing/whitespace
// differences don't cause false rejections.
function normalizeAnswer(answer) {
  return String(answer || '').trim().toLowerCase();
}

function hashAnswer(answer, salt) {
  return crypto.scryptSync(normalizeAnswer(answer), salt, 64).toString('hex');
}

// Fixed list so the frontend and backend agree on wording — stored on
// the account as plain text (it's not secret, the answer is).
export const SECURITY_QUESTIONS = Object.freeze([
  'What was the name of your first pet?',
  'What city were you born in?',
  'What was your childhood best friend\'s first name?',
  'What was the make of your first car?',
  'What is your mother\'s maiden name?',
]);

export async function createUser(username, password, email, securityQuestion, securityAnswer) {
  if (!isValidUsername(username)) {
    throw new Error('Username must be 3-32 characters: letters, numbers, underscore, or dash.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (!isValidEmail(email)) {
    throw new Error('A valid email is required — it\'s the only way to reset a lost password.');
  }
  if (!SECURITY_QUESTIONS.includes(securityQuestion)) {
    throw new Error('Pick one of the listed security questions.');
  }
  if (typeof securityAnswer !== 'string' || !securityAnswer.trim()) {
    throw new Error('A security answer is required.');
  }

  const existing = await redisCommand(['HGET', USERS_KEY, username]);
  if (existing) {
    throw new Error('That username is already taken.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const answerSalt = crypto.randomBytes(16).toString('hex');
  const securityAnswerHash = hashAnswer(securityAnswer, answerSalt);
  // The pre-check above is only a fast rejection. Another signup can
  // arrive before this write, so creation itself must be atomic and
  // must never replace credentials attached to existing history/usage.
  const created = await redisCommand([
    'HSETNX',
    USERS_KEY,
    username,
    JSON.stringify({
      salt,
      passwordHash,
      email,
      securityQuestion,
      answerSalt,
      securityAnswerHash,
      createdAt: Date.now(),
    }),
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

export async function getUserEmail(username) {
  if (!isValidUsername(username)) return null;
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) return null;
  try {
    return JSON.parse(raw).email || null;
  } catch {
    return null;
  }
}

// Always returns *some* question, even for a username that doesn't
// exist, so this endpoint can't be used to check which usernames are
// real accounts by whether a question comes back.
const DECOY_QUESTION = SECURITY_QUESTIONS[0];
export async function getSecurityQuestion(username) {
  if (!isValidUsername(username)) return DECOY_QUESTION;
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) return DECOY_QUESTION;
  try {
    return JSON.parse(raw).securityQuestion || DECOY_QUESTION;
  } catch {
    return DECOY_QUESTION;
  }
}

// Dummy salt/hash used when the username doesn't exist, so a
// nonexistent account still runs through a real scrypt comparison
// instead of short-circuiting — keeps the failure path's shape (and
// rough timing) consistent whether or not the account is real.
const DUMMY_ANSWER_SALT = 'nexus-forge-decoy-salt';
const DUMMY_ANSWER_HASH = hashAnswer('nexus-forge-decoy-answer', DUMMY_ANSWER_SALT);

export async function verifySecurityAnswer(username, answer) {
  let answerSalt = DUMMY_ANSWER_SALT;
  let securityAnswerHash = DUMMY_ANSWER_HASH;
  if (isValidUsername(username)) {
    const raw = await redisCommand(['HGET', USERS_KEY, username]);
    if (raw) {
      try {
        const record = JSON.parse(raw);
        if (record.answerSalt && record.securityAnswerHash) {
          answerSalt = record.answerSalt;
          securityAnswerHash = record.securityAnswerHash;
        }
      } catch {
        // fall through to dummy hash
      }
    }
  }
  const attemptHash = hashAnswer(answer, answerSalt);
  const a = Buffer.from(attemptHash, 'hex');
  const b = Buffer.from(securityAnswerHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Used by the "forgot password" flow (api/password-reset.js) once a
// reset token has already been verified — this function itself does
// no verification, so it must never be reachable without a valid,
// single-use token consumed first.
export async function setUserPassword(username, newPassword) {
  if (!isValidUsername(username)) throw new Error('Invalid username.');
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) throw new Error('No such user.');
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error('Corrupt user record.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  record.salt = salt;
  record.passwordHash = hashPassword(newPassword, salt);
  await redisCommand(['HSET', USERS_KEY, username, JSON.stringify(record)]);
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

// ---- Plan tier (no billing wired yet — see PLANS above) ----

export async function getUserPlan(username) {
  if (!username) return PLANS.FREE;
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) return PLANS.FREE;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return PLANS.FREE;
  }
  return KNOWN_PLANS.has(record.plan) ? record.plan : PLANS.FREE;
}

// Safe-fields listing of every Room account, for the operator dashboard.
// Deliberately omits salt/passwordHash/securityAnswerHash/answerSalt —
// this is meant to be handed to a customer-ops UI, not a full user dump.
export async function listUsers() {
  const raw = await redisCommand(['HGETALL', USERS_KEY]);
  if (!raw || !Array.isArray(raw)) return [];
  const users = [];
  for (let i = 0; i < raw.length; i += 2) {
    const username = raw[i];
    try {
      const record = JSON.parse(raw[i + 1]);
      users.push({
        username,
        email: record.email || null,
        plan: KNOWN_PLANS.has(record.plan) ? record.plan : PLANS.FREE,
        stripeCustomerId: record.stripeCustomerId || null,
        forgeRole: record.forgeRole || null,
        createdAt: record.createdAt || null,
      });
    } catch {
      // skip a malformed entry rather than crashing the whole list
    }
  }
  return users;
}

export function isPaidPlan(plan) {
  return Boolean(plan) && plan !== PLANS.FREE;
}

// Manual for now (see PLANS above) — call this by hand (or from a
// future Stripe webhook) after a payment. Preserves the existing
// salt/passwordHash/createdAt fields; only the plan field changes.
export async function setUserPlan(username, plan) {
  if (!isValidUsername(username)) throw new Error('Invalid username.');
  if (!KNOWN_PLANS.has(plan)) throw new Error(`Unknown plan: ${plan}`);
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) throw new Error('No such user.');
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error('Corrupt user record.');
  }
  record.plan = plan;
  await redisCommand(['HSET', USERS_KEY, username, JSON.stringify(record)]);
  return { username, plan };
}

// Records which username a Stripe Customer id belongs to. Called once
// a subscription checkout completes (api/webhooks/stripe.js) so a
// later cancellation event can be traced back to an account, and also
// stored on the user record itself so the Customer Portal (which
// needs a forward username -> customer id lookup) can find it.
export async function linkStripeCustomer(username, customerId) {
  if (!isValidUsername(username) || !customerId) return;
  await redisCommand(['HSET', STRIPE_CUSTOMERS_KEY, customerId, username]);
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) return;
  try {
    const record = JSON.parse(raw);
    record.stripeCustomerId = customerId;
    await redisCommand(['HSET', USERS_KEY, username, JSON.stringify(record)]);
  } catch {
    console.error('linkStripeCustomer: corrupt user record for', username);
  }
}

export async function getUsernameByStripeCustomer(customerId) {
  if (!customerId) return null;
  return (await redisCommand(['HGET', STRIPE_CUSTOMERS_KEY, customerId])) || null;
}

export async function getStripeCustomerId(username) {
  if (!isValidUsername(username)) return null;
  const raw = await redisCommand(['HGET', USERS_KEY, username]);
  if (!raw) return null;
  try {
    return JSON.parse(raw).stripeCustomerId || null;
  } catch {
    return null;
  }
}