// api/forge-metrics.js
// Operator-only reporting endpoint for the Nexus Forge owner dashboard.

import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';
import { getForgeMetrics } from '../lib/forgeMetrics.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const username = await getRequestUser(req);
  if (!username || !isOperatorUser(username)) {
    return res.status(403).json({ error: 'Operator access required.' });
  }

  try {
    const metrics = await getForgeMetrics();
    return res.status(200).json(metrics);
  } catch (err) {
    console.error('forge-metrics handler failed:', err.message);
    return res.status(500).json({ error: 'Could not load metrics.' });
  }
}
