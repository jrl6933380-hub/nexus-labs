// api/checkout.js
// Creates a Stripe Checkout Session for a plan upgrade or a credit
// pack top-up. Requires an existing Room session — a customer only
// reaches a paid tier button after signing in (see the tier modal in
// public/room-login.html), so there's always a username to attach the
// purchase to by the time this route is hit.
//
// Raw fetch to the Stripe REST API rather than the stripe npm
// package, matching this repo's existing no-new-dependencies pattern
// for third-party services (see lib/roomAuth.js, lib/board.js).

import { getRequestUser } from '../lib/roomAuth.js';
import { resolveCheckoutPrice } from '../lib/billingPlans.js';

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
    console.error('checkout: missing STRIPE_SECRET_KEY');
    return res.status(500).json({ error: 'Billing is not configured yet.' });
  }

  try {
    const username = await getRequestUser(req);
    if (!username) return res.status(401).json({ error: 'Sign in first.' });

    const { priceId, projectId } = req.body || {};
    const resolved = resolveCheckoutPrice(priceId);
    if (!resolved) return res.status(400).json({ error: 'Unknown price.' });
    const isProjectScoped = resolved.kind === 'site_agent' || resolved.kind === 'site_agent_reply_pack';
    if (isProjectScoped && (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(projectId))) {
      return res.status(400).json({ error: 'A valid project is required for this purchase.' });
    }

    const session = await stripeRequest('checkout/sessions', {
      mode: resolved.mode,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      client_reference_id: username,
      'metadata[username]': username,
      'metadata[kind]': resolved.kind,
      ...(resolved.kind === 'plan' ? { 'metadata[plan]': resolved.plan } : {}),
      ...(resolved.kind === 'credit_pack' ? { 'metadata[credits]': resolved.credits } : {}),
      ...(resolved.kind === 'site_agent' ? { 'metadata[projectId]': projectId, 'metadata[monthlyLimit]': resolved.monthlyLimit } : {}),
      ...(resolved.kind === 'site_agent_reply_pack' ? { 'metadata[projectId]': projectId, 'metadata[replies]': resolved.replies } : {}),
      success_url: `${SITE_URL}/room.html?checkout=success`,
      cancel_url: `${SITE_URL}/room-login.html?checkout=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('checkout error:', err.message);
    return res.status(500).json({ error: 'Could not start checkout.' });
  }
}
