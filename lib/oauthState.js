// lib/oauthState.js
// Signed, short-lived CSRF state tokens for the BYO OAuth flow (task
// 09). The state token itself is what authorizes a callback request
// -- not a session cookie -- which is the standard pattern for OAuth
// redirects that may bounce through a different tab/browser context.
// Same signed-token shape as lib/capabilityGateway.js's grants, reused
// here rather than inventing a second signing mechanism.

import crypto from 'crypto';

function secret() {
  const s = process.env.NEXUS_GRANT_SIGNING_SECRET;
  if (!s) throw new Error('NEXUS_GRANT_SIGNING_SECRET is not configured');
  return s;
}
function b64(v) { return Buffer.from(v).toString('base64url'); }
function unb64(v) { return Buffer.from(v, 'base64url').toString('utf8'); }
function sign(v) { return crypto.createHmac('sha256', secret()).update(v).digest('base64url'); }
function constantTimeEqual(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createOAuthState({ tenant_id, owner, provider, ttl_ms = 10 * 60 * 1000 } = {}) {
  if (!tenant_id || !owner || !provider) throw new Error('tenant_id, owner, and provider are required');
  const payload = {
    tenant_id, owner, provider,
    nonce: crypto.randomBytes(12).toString('hex'),
    iat: Date.now(),
    exp: Date.now() + ttl_ms,
  };
  const encoded = b64(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOAuthState(token) {
  if (!token || typeof token !== 'string') throw new Error('Missing OAuth state');
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !constantTimeEqual(sign(encoded), signature)) {
    throw new Error('Invalid OAuth state');
  }
  let payload;
  try { payload = JSON.parse(unb64(encoded)); } catch { throw new Error('Malformed OAuth state'); }
  if (payload.exp <= Date.now()) throw new Error('Expired OAuth state');
  return payload;
}
