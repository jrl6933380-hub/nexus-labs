// lib/roomProjectLedger.js
// Per-project credit spend, per account.
//
// The meter in lib/roomMetering.js answers "how much has this ACCOUNT spent
// this period" — that's what enforces limits. It deliberately doesn't know
// about projects. This ledger answers the other question: "how much work
// went into THIS project", which is what makes an export price defensible
// rather than invented. A customer can be shown the number and it matches
// what they watched happen.
//
// Deliberately additive-only and cheap: one HINCRBY per settled build,
// keyed by account, field per project. It is a record of work done, not a
// balance — nothing here is ever decremented, so it survives a plan change,
// a refund, or a period rollover. It is NOT the credit limit and must never
// be used to gate a build; roomMetering owns that.
//
// Same raw-Redis-REST pattern as lib/roomHistory.js, reusing the existing
// KV_REST_API_URL / KV_REST_API_TOKEN. No new infrastructure.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function ledgerKey(userId) {
  return `nexus:room:project-credits:${userId}`;
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Redis command failed');
  return data.result;
}

/**
 * Add settled credits to a project's running total.
 *
 * Call this only with credits actually CHARGED (settleBuild's `charged`),
 * never the reserved amount — a failed build reserves and then releases,
 * and billing a customer for work that didn't happen is the whole thing
 * this is meant to avoid.
 *
 * Returns the project's new total, or null when there is nothing to
 * record (zero charge, missing ids, exempt owner account).
 */
export async function recordProjectSpend({ userId, projectId, credits } = {}) {
  const amount = Number(credits);
  if (!userId || !projectId || !Number.isFinite(amount) || amount <= 0) return null;
  return redisCommand(['HINCRBY', ledgerKey(userId), String(projectId), String(Math.round(amount))]);
}

/** Credits spent on one project. Returns 0 for a project with no history. */
export async function getProjectSpend({ userId, projectId } = {}) {
  if (!userId || !projectId) return 0;
  const raw = await redisCommand(['HGET', ledgerKey(userId), String(projectId)]);
  return Number(raw) || 0;
}

/**
 * Every project this account has spent credits on, biggest first — the
 * shape a "customer · project · credits spent" view wants.
 */
export async function listProjectSpend(userId) {
  if (!userId) return [];
  const flat = await redisCommand(['HGETALL', ledgerKey(userId)]);
  if (!Array.isArray(flat) || flat.length === 0) return [];
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) {
    rows.push({ projectId: flat[i], credits: Number(flat[i + 1]) || 0 });
  }
  return rows.sort((a, b) => b.credits - a.credits);
}
