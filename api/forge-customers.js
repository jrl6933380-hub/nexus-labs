// api/forge-customers.js
// Operator-only customer-ops surface: list accounts with plan/usage/
// billing status, and act on one via the existing approved billing
// actions (lib/stripeAdmin.js) — grant bonus credits, change plan,
// or cancel a subscription. No new billing logic here; this is a
// thin, operator-authenticated HTTP wrapper around what already
// existed for Nex's approved actions.

import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';
import { listForgeCustomers } from '../lib/forgeCustomers.js';
import { executeBillingAction, validateBillingAction } from '../lib/stripeAdmin.js';

const ALLOWED_FROM_DASHBOARD = new Set(['grant_bonus_credits', 'set_user_plan', 'cancel_subscription']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const username = await getRequestUser(req);
  if (!username || !isOperatorUser(username)) {
    return res.status(403).json({ error: 'Operator access required.' });
  }

  try {
    if (req.method === 'GET') {
      const customers = await listForgeCustomers();
      return res.status(200).json({ customers });
    }

    if (req.method === 'POST') {
      const action = req.body || {};
      if (!ALLOWED_FROM_DASHBOARD.has(action.action)) {
        return res.status(400).json({ error: 'Unsupported action from this dashboard.' });
      }
      validateBillingAction(action);
      const result = await executeBillingAction(action);
      return res.status(200).json({ result });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('forge-customers handler failed:', err.message);
    return res.status(400).json({ error: err.message || 'Request failed.' });
  }
}
