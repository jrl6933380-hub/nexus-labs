// api/room-usage.js
// Read-only usage summary for the signed-in Room account.
// Credits are a safety/metering unit, not a billing statement.

import { getRequestUser } from '../lib/roomAuth.js';
import { roomMeter } from '../lib/roomMetering.js';

export function createUsageHandler({ resolveUser = getRequestUser, meter = roomMeter } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    try {
      const username = await resolveUser(req);
      if (!username) return res.status(401).json({ error: 'Sign in required' });
      const usage = await meter.getUsageSummary(username);
      return res.status(200).json({ usage });
    } catch (err) {
      console.error('room-usage handler failed:', err.message);
      return res.status(500).json({ error: 'Could not load Room usage' });
    }
  };
}

export default createUsageHandler();
