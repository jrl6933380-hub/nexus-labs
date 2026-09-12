// api/billing-portal.js
// Sends a signed-in paid account to Stripe's hosted Customer Portal,
// where they can update payment methods, change plans, or cancel
// self-serve — without needing to message support for it.
//
// Same raw-fetch-to-Stripe-REST pattern as api/checkout.js.

import { getRequestUser, getStripeCustomerId } from '../lib/roomAuth.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'https://nexus-labs-sigma.vercel.app';

async function stripeRequest(path, body) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Stripe API error:', data.error?.message || res.status);
    throw new Error(data.error?.message || 'Stripe request failed');
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!STRIPE_SECRET_KEY) {
    console.error('billing-portal: missing STRIPE_SECRET_KEY');
    return res.status(500).json({ error: 'Billing is not configured yet.' });
  }

  try {
    const username = await getRequestUser(req);
    if (!username) return res.status(401).json({ error: 'Sign in first.' });

    const customerId = await getStripeCustomerId(username);
    if (!customerId) {
      return res.status(400).json({
        error: 'No billing account on file yet — pick a paid tier first.',
        code: 'NO_BILLING_ACCOUNT',
      });
    }

    const session = await stripeRequest('billing_portal/sessions', {
      customer: customerId,
      return_url: `${SITE_URL}/room.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('billing-portal error:', err.message);
    return res.status(500).json({ error: 'Could not open billing portal.' });
  }
}
