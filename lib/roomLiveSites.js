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

export async function recordLiveSite(userId, projectId, { url, deploymentId } = {}) {
  if (!userId || !projectId) return null;
  const value = JSON.stringify({ url: url || null, deploymentId: deploymentId || null, publishedAt: Date.now() });
  await redisCommand(['HSET', liveKey(userId), String(projectId), value]);
  return { projectId, url: url || null };
}

// Frees the slot. Used when a project is deleted and when a customer takes
// a site down.
//
// NOTE: this removes our RECORD of the site, which is what the cap counts.
// Tearing down the deployment itself is a separate concern and is not done
// here — there is no verified delete path for a published deployment yet
// (the same gap noted in the client-launch rollback work). So a freed slot
// can currently leave an orphaned live URL until that exists. Worth closing
// before the cap is load-bearing for revenue.
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
