// api/forge-connect.js
// Caller payout setup through Stripe Connect Express.
// GET  /api/forge-connect -> { connected, payoutsEnabled, detailsSubmitted }
// POST /api/forge-connect -> { url } Stripe-hosted onboarding (bank + identity).
// Stripe collects the bank and tax details; nothing sensitive touches our servers.

import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker } from '../lib/forgeRoles.js';
import { ensureCaller, setCallerConnectAccount } from '../lib/forgeDb.js';
import { createCallerConnectAccount, createConnectOnboardingLink, getConnectAccount } from '../lib/forgeStripe.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const username = await getRequestUser(req);
  if (!username) return res.status(401).json({ error: 'Sign in required.' });
  if (!(await isForgeWorker(username))) return res.status(403).json({ error: 'Not a Forge account.' });

  try {
    let caller = await ensureCaller(username);

    if (req.method === 'GET') {
      if (!caller.stripe_connect_account_id) return res.status(200).json({ connected: false, payoutsEnabled: false });
      const account = await getConnectAccount(caller.stripe_connect_account_id);
      return res.status(200).json({
        connected: true,
        payoutsEnabled: Boolean(account.payouts_enabled),
        detailsSubmitted: Boolean(account.details_submitted),
      });
    }

    if (req.method === 'POST') {
      if (!caller.stripe_connect_account_id) {
        const accountId = await createCallerConnectAccount(caller);
        caller = await setCallerConnectAccount(caller.id, accountId);
      }
      const url = await createConnectOnboardingLink(caller.stripe_connect_account_id);
      return res.status(200).json({ url });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('forge-connect failed:', err.message);
    const notEnabled = /connect/i.test(err.message) && /(sign up|enable|platform)/i.test(err.message);
    return res.status(notEnabled ? 503 : 400).json({
      error: notEnabled ? 'Payouts are not switched on yet. Your earnings are safe and will stay owed until they are.' : err.message,
    });
  }
}
