// lib/roomLiveSites.js
// Registry of a customer's live (published) sites, and the per-plan cap on
// how many they may have at once.
//
// Publishing uses a per-project slug (slugForProject), so republishing the
// same project UPDATES that site rather than creating a second one. That
// makes "number of distinct published projects" an honest count of live
// sites, and it means re-publishing an already-live project must never be
// blocked by the cap — only going live with a NEW project can be.
//
// Same raw-Redis-REST pattern as lib/roomHistory.js, reusing the existing
// KV_REST_API_URL / KV_REST_API_TOKEN. No new infrastructure.

import { PLANS } from './roomAuth.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// How many sites each plan may have live at once.
//
// These are the product's numbers, not a technical limit — they are meant
// to be edited. Free is 0 because going live already requires a paid plan
// (PUBLISH_REQUIRES_PAID_PLAN in api/room-publish.js); it is listed
// explicitly so the table reads as the whole story rather than leaving a
// tier implied.
export const LIVE_SITE_LIMITS = Object.freeze({
  [PLANS.FREE]: 0,
  [PLANS.HOSTED]: 1,
  [PLANS.GROWTH]: 5,
  [PLANS.UNLIMITED]: Infinity,
});

export function liveSiteLimit(plan) {
  const limit = LIVE_SITE_LIMITS[plan];
  // An unknown/missing plan is treated as free rather than unlimited:
  // fail closed, the same way canExport does.
  return limit === undefined ? LIVE_SITE_LIMITS[PLANS.FREE] : limit;
}

function liveKey(userId) {
  return `nexus:room:live-sites:${userId}`;
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

export async function listLiveSites(userId) {
  if (!userId) return [];
  const flat = await redisCommand(['HGETALL', liveKey(userId)]);
  if (!Array.isArray(flat) || flat.length === 0) return [];
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      rows.push({ projectId: flat[i], ...JSON.parse(flat[i + 1]) });
    } catch {
      rows.push({ projectId: flat[i] });
    }
  }
  return rows.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

export async function isProjectLive(userId, projectId) {
  if (!userId || !projectId) return false;
  const raw = await redisCommand(['HGET', liveKey(userId), String(projectId)]);
  return raw != null;
}

export async function recordLiveSite(userId, projectId, { url, deploymentId, projectName } = {}) {
  if (!userId || !projectId) return null;
  // projectName is the Vercel project slug. Stored rather than re-derived
  // at teardown time so taking a site down can never target the wrong
  // project because a slug rule changed after it was published.
  const value = JSON.stringify({
    url: url || null,
    deploymentId: deploymentId || null,
    projectName: projectName || null,
    publishedAt: Date.now(),
  });
  await redisCommand(['HSET', liveKey(userId), String(projectId), value]);
  return { projectId, url: url || null, projectName: projectName || null };
}

/** The stored record for one live site, or null. */
export async function getLiveSite(userId, projectId) {
  if (!userId || !projectId) return null;
  const raw = await redisCommand(['HGET', liveKey(userId), String(projectId)]);
  if (raw == null) return null;
  try {
    return { projectId: String(projectId), ...JSON.parse(raw) };
  } catch {
    return { projectId: String(projectId) };
  }
}

// Frees the slot by removing our record of the site. Callers that want the
// deployment actually torn down should use takeSiteOffline() below, which
// does both; this is the record-only half.
export async function removeLiveSite(userId, projectId) {
  if (!userId || !projectId) return { removed: 0 };
  const removed = await redisCommand(['HDEL', liveKey(userId), String(projectId)]);
  return { removed: Number(removed) || 0 };
}

/**
 * Decides whether this account may publish this project right now.
 *
 * Republishing an already-live project is always allowed — it updates the
 * existing site and does not consume another slot.
 */
export async function checkLiveSiteAllowance({ userId, projectId, plan } = {}) {
  const limit = liveSiteLimit(plan);
  if (limit === Infinity) return { allowed: true, limit, used: 0, unlimited: true };
  const sites = await listLiveSites(userId);
  const alreadyLive = sites.some((site) => site.projectId === String(projectId));
  if (alreadyLive) return { allowed: true, limit, used: sites.length, updating: true };
  if (sites.length >= limit) {
    return { allowed: false, limit, used: sites.length, unlimited: false };
  }
  return { allowed: true, limit, used: sites.length };
}

/**
 * Take a site offline for real: delete the Vercel project, then free the
 * slot.
 *
 * Order matters. The record is only removed after the deployment is
 * confirmed gone, so a failed teardown leaves the site both live AND
 * counted. The opposite order would free the slot while the site stayed
 * up — letting an account accumulate live URLs it isn't paying for, which
 * is the exact hole this closes.
 */
export async function takeSiteOffline({ userId, projectId, deleteSite } = {}) {
  if (!userId || !projectId) return { removed: 0, tornDown: false, reason: 'A user and project are required.' };
  const site = await getLiveSite(userId, projectId);
  if (!site) return { removed: 0, tornDown: false, reason: 'That project is not live.' };

  // Records written before projectName was stored have no slug to target.
  // Free the slot rather than trapping the customer, but say plainly that
  // the deployment may still be up so it can be cleaned up by hand.
  if (!site.projectName) {
    const freed = await removeLiveSite(userId, projectId);
    return { ...freed, tornDown: false, reason: 'No deployment name on record; the slot is free but the site may still be live.' };
  }

  const result = await deleteSite({ projectName: site.projectName });
  if (!result.deleted) {
    return { removed: 0, tornDown: false, reason: result.reason || 'Could not take the deployment down.' };
  }
  const freed = await removeLiveSite(userId, projectId);
  return { ...freed, tornDown: true, url: site.url || null, alreadyGone: Boolean(result.alreadyGone) };
}
