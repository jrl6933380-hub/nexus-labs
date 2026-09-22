// lib/emailVerification.js
// Single-use email confirmation tokens.
//
// Under BYOK this would be hygiene — an unverified account cost us
// nothing, because every build ran on the customer's own provider key.
// Funded Free changes that completely: each account can now spend our
// money, so the confirmed email is the one piece of friction standing
// between us and a scripted thousand signups draining the platform
// ceiling. That is why verification gates the FUNDED route specifically
// (see lib/forge/fundedAccess.js) rather than gating login: an
// unverified account still works fully on its own connected Brain,
// because that path costs us nothing.
//
// Same raw-Redis-REST pattern as lib/passwordReset.js, which this
// deliberately mirrors — tokens are single-use (GET then DEL) so a
// replayed link never verifies twice.

import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const VERIFY_PREFIX = 'nexus:room:verify:';
const RESEND_PREFIX = 'nexus:room:verify-resend:';
// Long enough that someone can confirm the next morning rather than
// being forced back through signup, short enough that a leaked link
// from an old inbox isn't useful indefinitely.
const VERIFY_TTL_SECONDS = 24 * 60 * 60;
// Resend throttle. Without this, "resend" is an open relay for mailing
// any address repeatedly via our sending domain, which is both abuse
// and a fast way to lose sender reputation.
const RESEND_COOLDOWN_SECONDS = 60;

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('emailVerification redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export async function createVerificationToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  await redisCommand(['SET', VERIFY_PREFIX + token, String(username), 'EX', String(VERIFY_TTL_SECONDS)]);
  return token;
}

/** Single-use: returns the username once, then the token is dead. */
export async function consumeVerificationToken(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const username = await redisCommand(['GET', VERIFY_PREFIX + token]);
  if (!username) return null;
  await redisCommand(['DEL', VERIFY_PREFIX + token]);
  return username;
}

/**
 * Best-effort per-account resend throttle. Returns false when a send
 * for this account happened inside the cooldown window. SET NX EX is
 * atomic, so two simultaneous resend clicks can't both win.
 */
export async function claimResendSlot(username) {
  if (!username) return false;
  const result = await redisCommand([
    'SET', RESEND_PREFIX + encodeURIComponent(String(username)), '1',
    'NX', 'EX', String(RESEND_COOLDOWN_SECONDS),
  ]);
  return result === 'OK' || result === 'ok';
}

export function verificationEmailHtml({ username, link }) {
  return [
    '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px">',
    '<h2 style="margin:0 0 12px">Confirm your email</h2>',
    `<p style="color:#444;line-height:1.5">Hi ${escapeHtml(username)} — confirm this address to unlock building on Nexus Forge.</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#c9a227;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Confirm email</a></p>`,
    '<p style="color:#777;font-size:13px">This link expires in 24 hours. If you didn\'t create a Forge account, you can ignore this.</p>',
    '</div>',
  ].join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}
