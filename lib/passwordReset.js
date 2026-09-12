// lib/passwordReset.js
// Short-lived, single-use reset tokens for the "forgot password"
// flow. Same raw-Redis-REST pattern as lib/roomAuth.js.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const RESET_PREFIX = 'nexus:room:reset:';
const RESET_TTL_SECONDS = 30 * 60; // 30 minutes

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('passwordReset redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export async function createResetToken(username) {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await redisCommand(['SET', RESET_PREFIX + token, username, 'EX', String(RESET_TTL_SECONDS)]);
  return token;
}

// Single-use: GET then DEL, so replaying an already-used (or already
// expired) token never succeeds twice.
export async function consumeResetToken(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const username = await redisCommand(['GET', RESET_PREFIX + token]);
  if (!username) return null;
  await redisCommand(['DEL', RESET_PREFIX + token]);
  return username;
}
