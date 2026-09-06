// /api/cleanup.js
// Vercel Cron entry point for the permanent Cleaner service.

import { readBoard, postMessage } from '../lib/board.js';
import { createCleanupService } from '../lib/cleanupAgent.js';

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  // Never leave the endpoint open merely because a secret was forgotten.
  return Boolean(secret) && req.headers?.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const cleaner = createCleanupService({ readBoard, postMessage });
    return res.status(200).json({ cleanup: await cleaner.sweep() });
  } catch (err) {
    console.error('cleanup sweep failed:', err.message);
    return res.status(500).json({ error: 'Cleanup sweep failed' });
  }
}
