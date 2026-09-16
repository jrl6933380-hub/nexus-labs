// Conservative background memory curator. Vercel Cron authenticates with
// CRON_SECRET; fail closed if the deployment has not configured it.

import { curatePendingMemories } from '../lib/memory.js';

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers?.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    return res.status(200).json({ result: await curatePendingMemories({ force: true, limit: 10 }) });
  } catch (err) {
    console.error('memory curator sweep failed:', err.message);
    return res.status(500).json({ error: 'Memory curator sweep failed' });
  }
}
