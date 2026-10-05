// api/forge-sweep.js
// Hourly Vercel Cron for the Forge caller program's cancel timeline:
// clients past their 3-day live grace period drop to placeholder
// (name + phone), which also starts the clock on the day-14 follow-up
// call shown in Forge Ops. Same CRON_SECRET check as api/cleanup.js.

import { dueForPlaceholder, moveToPlaceholder } from '../lib/forgeDb.js';

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  // Never leave the endpoint open merely because a secret was forgotten.
  return Boolean(secret) && req.headers?.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const due = await dueForPlaceholder();
    const moved = [];
    for (const { id } of due) {
      const updated = await moveToPlaceholder({ clientId: id, changedBy: 'forge-sweep' });
      if (updated) moved.push(id);
    }
    return res.status(200).json({ checked: due.length, movedToPlaceholder: moved.length });
  } catch (err) {
    console.error('forge-sweep failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
