// api/room-usage.js
// Read-only usage summary for the signed-in Room account.
// Credits are a safety/metering unit, not a billing statement.
//
// `daily` is intentionally slim on purpose: only percentRemaining (and
// unlimited, for exempt/no-cap accounts) is returned, not the raw
// limit/consumed numbers — product decision is to show users a
// depleting bar, not a raw count, so the API itself doesn't hand the
// frontend a number to accidentally render.

import { getRequestUser } from '../lib/roomAuth.js';
import { getOrCreateAnonId } from '../lib/anonSession.js';
import { publicForgePricing } from '../lib/forgePricing.js';
import { roomMeter } from '../lib/roomMetering.js';

export function createUsageHandler({ resolveUser = getRequestUser, meter = roomMeter } = {}) {
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
      return res.status(200).json({ usage, daily, pricing: publicForgePricing() });
    } catch (err) {
      console.error('room-usage handler failed:', err.message);
      return res.status(500).json({ error: 'Could not load Room usage' });
    }
  };
}

export default createUsageHandler();
