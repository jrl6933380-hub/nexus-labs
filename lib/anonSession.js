// lib/anonSession.js
// Lets a visitor use the Free tier of Nexus Forge without creating an
// account first. A random, unsigned id in a long-lived cookie is
// enough here: it only ever unlocks Free-tier build credits (see
// lib/roomMetering.js) and a private-to-that-cookie project history —
// the same trust level as any ordinary anonymous analytics cookie. It
// carries no billing identity and no elevated access; a forged id
// just lands on a different (or empty) anonymous bucket.
//
// The 'anon:' prefix keeps these ids in their own namespace, distinct
// from real usernames (isValidUsername in lib/roomAuth.js never
// allows a colon), so an anon id can never collide with or spoof a
// real account.

import crypto from 'crypto';
import { parseCookies } from './roomAuth.js';

export const ANON_COOKIE = 'nexus_room_anon';
const ANON_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches roomAuth's SESSION_TTL_SECONDS

export function isAnonId(value) {
  return typeof value === 'string' && /^anon:[a-f0-9]{32}$/.test(value);
}

function createAnonId() {
  return 'anon:' + crypto.randomBytes(16).toString('hex');
}

function serializeAnonCookie(id) {
  return `${ANON_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ANON_TTL_SECONDS}`;
}

// Reads the anon cookie off a request; issues and sets a new one on
// `res` if there isn't a valid one yet. Always returns a usable id.
// Callers use this only after a real signed-in session check
// (getRequestUser) has already come back empty, so a real account is
// always preferred over an anonymous bucket when one exists.
export function getOrCreateAnonId(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies[ANON_COOKIE];
  if (isAnonId(existing)) return existing;
  const id = createAnonId();
  const prior = res.getHeader?.('Set-Cookie');
  const cookieHeader = serializeAnonCookie(id);
  res.setHeader('Set-Cookie', prior ? [].concat(prior, cookieHeader) : cookieHeader);
  return id;
}
