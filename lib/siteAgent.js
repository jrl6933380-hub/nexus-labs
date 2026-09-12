// lib/siteAgent.js
// Per-PROJECT (not per-account) config and usage for the Site Agent
// add-on \u2014 a chat widget embedded on a customer's published site.
// This is deliberately separate from lib/roomMetering.js: that meters
// the account owner's own building, keyed by username. This meters
// traffic from a client site's own visitors, keyed by projectId, and
// must never fall back to "unlimited" just because a lookup fails \u2014
// the whole point of this file is a hard, unmetered-by-default cap.
//
// Simpler atomic model than roomMetering's reserve/settle: a site
// agent reply is a single fast request/response, not a long-running
// generation that can be abandoned mid-flight, so a single
// increment-and-check script is enough \u2014 no separate reservation
// phase needed.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CONFIG_PREFIX = 'nexus:agent:config:';
const USAGE_PREFIX = 'nexus:agent:usage:';
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('siteAgent redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

function isValidProjectId(projectId) {
  return typeof projectId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(projectId);
}

function currentPeriod() {
  return Math.floor(Date.now() / MONTH_MS);
}

// INCR-and-check in one atomic step \u2014 no request can slip through
// between the check and the increment.
const CONSUME_SCRIPT = [
  "local limit = tonumber(ARGV[1])",
  "local used = redis.call('INCR', KEYS[1])",
  "redis.call('EXPIRE', KEYS[1], ARGV[2])",
  "if used > limit then return 0 end",
  "return 1",
].join('\n');

const GRANT_SCRIPT = [
  "local current = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "local updated = current - tonumber(ARGV[1])",
  "if updated < 0 then updated = 0 end",
  "redis.call('SET', KEYS[1], updated, 'EX', ARGV[2])",
  "return updated",
].join('\n');

export async function enableAgent(projectId, { username, monthlyLimit = 500, stripeSubscriptionId = null } = {}) {
  if (!isValidProjectId(projectId)) throw new Error('Invalid project id.');
  await redisCommand([
    'SET',
    CONFIG_PREFIX + projectId,
    JSON.stringify({ enabled: true, username, monthlyLimit, stripeSubscriptionId, enabledAt: Date.now() }),
  ]);
}

export async function disableAgent(projectId) {
  if (!isValidProjectId(projectId)) return;
  await redisCommand(['DEL', CONFIG_PREFIX + projectId]);
}

export async function getAgentConfig(projectId) {
  if (!isValidProjectId(projectId)) return null;
  const raw = await redisCommand(['GET', CONFIG_PREFIX + projectId]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// The core safety property this whole file exists for: a reply is
// only allowed if the increment-and-check script says so. Any error
// path (missing config, Redis failure) resolves to NOT allowed, never
// to "let it through" \u2014 the default for a metered resource is off.
export async function consumeAgentReply(projectId) {
  const config = await getAgentConfig(projectId);
  if (!config || !config.enabled) return { allowed: false, reason: 'not_enabled' };
  const period = currentPeriod();
  const key = USAGE_PREFIX + projectId + ':' + period;
  const ttlSeconds = Math.ceil(MONTH_MS / 1000);
  const result = await redisCommand(['EVAL', CONSUME_SCRIPT, '1', key, String(config.monthlyLimit), String(ttlSeconds)]);
  return { allowed: Number(result) === 1, reason: Number(result) === 1 ? null : 'limit_reached' };
}

// Fulfills a purchased reply pack \u2014 same "lower what's counted as
// used" approach as roomMetering's grantBonusCredits.
export async function grantBonusReplies(projectId, amount) {
  if (!isValidProjectId(projectId) || !(amount > 0)) return;
  const period = currentPeriod();
  const key = USAGE_PREFIX + projectId + ':' + period;
  const ttlSeconds = Math.ceil(MONTH_MS / 1000);
  await redisCommand(['EVAL', GRANT_SCRIPT, '1', key, String(amount), String(ttlSeconds)]);
}
