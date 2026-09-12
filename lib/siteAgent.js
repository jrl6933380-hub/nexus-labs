// lib/siteAgent.js
// Project-scoped configuration and runtime usage for AI assistants embedded on
// customer sites. This meter is deliberately independent of builder credits.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CONFIG_PREFIX = 'nexus:agent:config:';
const USAGE_PREFIX = 'nexus:agent:usage:';
const DAILY_USAGE_PREFIX = 'nexus:agent:daily:';
const RATE_LIMIT_PREFIX = 'nexus:agent:ratelimit:';
const PITCHED_PREFIX = 'nexus:agent:pitched:';
const SUBSCRIPTION_PROJECT_PREFIX = 'nexus:agent:subscription:';
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MONTHLY_LIMIT = 5000;
const MAX_DAILY_LIMIT = 250;
const RATE_LIMIT_MAX = 12;
const RATE_LIMIT_WINDOW_SECONDS = 60;

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

function safeInteger(value, fallback, maximum) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function currentPeriod(periodMs) {
  return Math.floor(Date.now() / periodMs);
}

// Atomically checks BOTH the project monthly ceiling and a daily burst ceiling
// before incrementing either counter. No model call can slip between check and
// charge, and rejected requests do not consume quota.
export const CONSUME_SCRIPT = [
  "local monthlyLimit = tonumber(ARGV[1])",
  "local dailyLimit = tonumber(ARGV[2])",
  "local monthlyUsed = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "local dailyUsed = tonumber(redis.call('GET', KEYS[2]) or '0')",
  "if monthlyUsed >= monthlyLimit then return -1 end",
  "if dailyUsed >= dailyLimit then return -2 end",
  "monthlyUsed = redis.call('INCR', KEYS[1])",
  "dailyUsed = redis.call('INCR', KEYS[2])",
  "redis.call('EXPIRE', KEYS[1], ARGV[3])",
  "redis.call('EXPIRE', KEYS[2], ARGV[4])",
  "return monthlyUsed",
].join('\n');

const GRANT_SCRIPT = [
  "local current = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "local updated = current - tonumber(ARGV[1])",
  "if updated < 0 then updated = 0 end",
  "redis.call('SET', KEYS[1], updated, 'EX', ARGV[2])",
  "return updated",
].join('\n');

export async function enableAgent(projectId, {
  username,
  monthlyLimit = 500,
  dailyLimit,
  stripeSubscriptionId = null,
} = {}) {
  if (!isValidProjectId(projectId)) throw new Error('Invalid project id.');
  const safeMonthlyLimit = safeInteger(monthlyLimit, 500, MAX_MONTHLY_LIMIT);
  const safeDailyLimit = safeInteger(
    dailyLimit,
    Math.max(10, Math.min(50, Math.ceil(safeMonthlyLimit / 10))),
    Math.min(MAX_DAILY_LIMIT, safeMonthlyLimit)
  );
  await redisCommand([
    'SET',
    CONFIG_PREFIX + projectId,
    JSON.stringify({
      enabled: true,
      username,
      monthlyLimit: safeMonthlyLimit,
      dailyLimit: safeDailyLimit,
      stripeSubscriptionId,
      enabledAt: Date.now(),
    }),
  ]);
  if (stripeSubscriptionId) await linkSubscriptionToProject(stripeSubscriptionId, projectId);
}

export async function linkSubscriptionToProject(subscriptionId, projectId) {
  if (!subscriptionId || !isValidProjectId(projectId)) return;
  await redisCommand(['SET', SUBSCRIPTION_PROJECT_PREFIX + subscriptionId, projectId]);
}

export async function getProjectBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return (await redisCommand(['GET', SUBSCRIPTION_PROJECT_PREFIX + subscriptionId])) || null;
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
    const config = JSON.parse(raw);
    if (!config || config.enabled !== true) return null;
    const monthlyLimit = safeInteger(config.monthlyLimit, 500, MAX_MONTHLY_LIMIT);
    return {
      ...config,
      monthlyLimit,
      dailyLimit: safeInteger(
        config.dailyLimit,
        Math.max(10, Math.min(50, Math.ceil(monthlyLimit / 10))),
        Math.min(MAX_DAILY_LIMIT, monthlyLimit)
      ),
    };
  } catch {
    return null;
  }
}

// Fail CLOSED. If config or Redis is unavailable, callers must return a static
// fallback and must not call the model. This is the primary cost boundary.
export async function consumeAgentReply(projectId) {
  try {
    const config = await getAgentConfig(projectId);
    if (!config) return { allowed: false, reason: 'not_enabled' };
    const month = currentPeriod(MONTH_MS);
    const day = currentPeriod(DAY_MS);
    const result = Number(await redisCommand([
      'EVAL',
      CONSUME_SCRIPT,
      '2',
      USAGE_PREFIX + projectId + ':' + month,
      DAILY_USAGE_PREFIX + projectId + ':' + day,
      String(config.monthlyLimit),
      String(config.dailyLimit),
      String(Math.ceil(MONTH_MS / 1000)),
      String(Math.ceil(DAY_MS / 1000)),
    ]));
    if (result === -1) return { allowed: false, reason: 'monthly_limit_reached' };
    if (result === -2) return { allowed: false, reason: 'daily_limit_reached' };
    if (result < 1) return { allowed: false, reason: 'meter_unavailable' };
    return { allowed: true, reason: null };
  } catch (err) {
    console.error('siteAgent consumeAgentReply failed closed:', err.message);
    return { allowed: false, reason: 'meter_unavailable' };
  }
}

export async function grantBonusReplies(projectId, amount) {
  if (!isValidProjectId(projectId) || !(amount > 0)) return;
  const month = currentPeriod(MONTH_MS);
  await redisCommand([
    'EVAL',
    GRANT_SCRIPT,
    '1',
    USAGE_PREFIX + projectId + ':' + month,
    String(Math.floor(amount)),
    String(Math.ceil(MONTH_MS / 1000)),
  ]);
}

export async function wasAgentPitched(projectId) {
  if (!isValidProjectId(projectId)) return true;
  return Boolean(await redisCommand(['GET', PITCHED_PREFIX + projectId]));
}

export async function markAgentPitched(projectId) {
  if (!isValidProjectId(projectId)) return;
  await redisCommand(['SET', PITCHED_PREFIX + projectId, '1']);
}

// Secondary abuse control. The hard project ceilings above remain fail-closed,
// so a rate-limit store hiccup cannot create unlimited model usage.
export async function checkRateLimit(projectId, ip) {
  if (!isValidProjectId(projectId) || !ip) return { allowed: true };
  try {
    const key = RATE_LIMIT_PREFIX + projectId + ':' + ip;
    const count = await redisCommand(['INCR', key]);
    if (Number(count) === 1) await redisCommand(['EXPIRE', key, String(RATE_LIMIT_WINDOW_SECONDS)]);
    return { allowed: Number(count) <= RATE_LIMIT_MAX };
  } catch (err) {
    console.error('siteAgent checkRateLimit failed, relying on hard caps:', err.message);
    return { allowed: true };
  }
}
