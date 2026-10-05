// api/room-usage.js
// Read-only usage summary for the signed-in Room account.
// Credits are a safety/metering unit, not a billing statement.
//
// `daily` is intentionally slim on purpose: only percentRemaining (and
// unlimited, for exempt/no-cap accounts) is returned, not the raw
// limit/consumed numbers — product decision is to show users a
// depleting bar, not a raw count, so the API itself doesn't hand the
// frontend a number to accidentally render.

import { getRequestUser, getUserPlan, isPaidPlan } from '../lib/roomAuth.js';
import { getOrCreateAnonId } from '../lib/anonSession.js';
import { publicForgePricing } from '../lib/forgePricing.js';
import { roomMeter } from '../lib/roomMetering.js';

export function createUsageHandler({ resolveUser = getRequestUser, meter = roomMeter, resolvePlan = getUserPlan } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    try {
      let username = await resolveUser(req);
      if (!username) username = getOrCreateAnonId(req, res);
      const usage = await meter.getUsageSummary(username);
      const dailyFull = await meter.getDailyUsageSummary(username);
      const daily = dailyFull.unlimited
        ? { unlimited: true, percentRemaining: 100 }
        : { unlimited: false, percentRemaining: dailyFull.percentRemaining };
      // canExport mirrors the server-side gate in api/room-history.js so the
      // UI can offer the upsell instead of handing a free account the file.
      // It is a product boundary, NOT a security one: the generated HTML is
      // already in the visitor's browser (the preview iframe renders it), so
      // anyone determined can read it out of the page. The server download
      // endpoint stays authoritative regardless of what this says.
      let canExport = false;
      try {
        canExport = isPaidPlan(await resolvePlan(username));
      } catch (planError) {
        console.error('room-usage: plan lookup failed, defaulting export to locked:', planError.message);
      }
      return res.status(200).json({ usage, daily, pricing: publicForgePricing(), canExport });
    } catch (err) {
      console.error('room-usage handler failed:', err.message);
      return res.status(500).json({ error: 'Could not load Room usage' });
    }
  };
}

export default createUsageHandler();
