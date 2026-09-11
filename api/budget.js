// /api/budget.js
// Read-only view of this month's token spend and what's left.
// Consumed by the budget meter in the dashboard header.

import { initSentry, Sentry } from '../lib/sentry.js';
import { getBudgetStatus } from '../lib/budget.js';

export default async function handler(req, res) {
  initSentry();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const status = await getBudgetStatus();
    return res.status(200).json(status);
  } catch (err) {
    console.error('GET /api/budget failed:', err.message);
    Sentry.captureException(err);
    // Deliberately 200 with an error flag: a broken budget widget must
    // not make the dashboard look like it's down.
    return res.status(200).json({ error: 'Budget unavailable', tracked: false });
  }
}
