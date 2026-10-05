// lib/stripeAdmin.js
// Narrow, server-side Stripe administration surface for approved Nex actions.
// Secrets stay in environment variables; tool inputs may contain only Stripe
// object ids and bounded action parameters.

import { setUserPlan, PLANS } from './roomAuth.js';
import { roomMeter } from './roomMetering.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const ALLOWED_PLANS = new Set(Object.values(PLANS));
const ALLOWED_ACTIONS = new Set([
  'refund_payment',
  'cancel_subscription',
  'set_user_plan',
  'grant_bonus_credits',
]);

function requireStripeId(value, prefix, label) {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requireUsername(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(value)) {
    throw new Error('Invalid username.');
  }
  return value;
}

async function stripeRequest(path, { method = 'GET', body } = {}) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe is not configured.');
  const options = {
    method,
    headers: { Authorization: `Bearer ${secret}` },
  };
  if (body) {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(body);
  }
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed (${response.status}).`);
  return data;
}

export function validateBillingAction(input = {}) {
  if (!ALLOWED_ACTIONS.has(input.action)) throw new Error('Unsupported billing action.');
  if (input.action === 'refund_payment') {
    requireStripeId(input.payment_intent, 'pi', 'payment intent');
    if (input.amount_cents !== undefined && (!Number.isInteger(input.amount_cents) || input.amount_cents < 1 || input.amount_cents > 100000000)) {
      throw new Error('Refund amount must be an integer from 1 to 100000000 cents.');
    }
  }
  if (input.action === 'cancel_subscription') requireStripeId(input.subscription_id, 'sub', 'subscription id');
  if (input.action === 'set_user_plan') {
    requireUsername(input.username);
    if (!ALLOWED_PLANS.has(input.plan)) throw new Error('Unknown plan.');
  }
  if (input.action === 'grant_bonus_credits') {
    requireUsername(input.username);
    if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > 100000) {
      throw new Error('Credits must be an integer from 1 to 100000.');
    }
  }
  return input;
}

export function describeBillingAction(input) {
  validateBillingAction(input);
  if (input.action === 'refund_payment') {
    return `Refund Stripe payment ${input.payment_intent}${input.amount_cents ? ` by ${input.amount_cents} cents` : ' in full'}`;
  }
  if (input.action === 'cancel_subscription') return `Cancel Stripe subscription ${input.subscription_id}`;
  if (input.action === 'set_user_plan') return `Set Nexus user ${input.username} to ${input.plan} plan`;
  return `Grant ${input.credits} bonus credits to Nexus user ${input.username}`;
}

export async function executeBillingAction(input) {
  validateBillingAction(input);
  if (input.action === 'refund_payment') {
    return stripeRequest('refunds', {
      method: 'POST',
      body: {
        payment_intent: input.payment_intent,
        ...(input.amount_cents ? { amount: String(input.amount_cents) } : {}),
      },
    });
  }
  if (input.action === 'cancel_subscription') {
    return stripeRequest(`subscriptions/${input.subscription_id}`, { method: 'DELETE' });
  }
  if (input.action === 'set_user_plan') return setUserPlan(input.username, input.plan);
  return roomMeter.grantBonusCredits(input.username, input.credits);
}

export async function getStripeObject({ object_type, id }) {
  const paths = {
    customer: ['cus', 'customers'],
    subscription: ['sub', 'subscriptions'],
    payment_intent: ['pi', 'payment_intents'],
    refund: ['re', 'refunds'],
  };
  const mapping = paths[object_type];
  if (!mapping) throw new Error('Unsupported Stripe object type.');
  requireStripeId(id, mapping[0], object_type);
  const data = await stripeRequest(`${mapping[1]}/${id}`);
  // Return a bounded operational summary. Never relay payment method details.
  return {
    id: data.id,
    object: data.object,
    customer: typeof data.customer === 'string' ? data.customer : data.customer?.id || null,
    status: data.status || null,
    amount: data.amount ?? data.amount_refunded ?? null,
    currency: data.currency || null,
    created: data.created || null,
    livemode: Boolean(data.livemode),
    cancel_at_period_end: data.cancel_at_period_end ?? null,
  };
}

// Bounded operational summary of a customer's most recent subscription,
// for the operator customer-ops dashboard — not the payment-method or
// invoice-line-item detail Stripe's own dashboard shows. Returns null
// for a customer with no subscription on record (e.g. never checked
// out, or on a manually-set plan).
export async function getCustomerBillingStatus(customerId) {
  if (typeof customerId !== 'string' || !customerId) return null;
  requireStripeId(customerId, 'cus', 'customer id');
  const data = await stripeRequest(`subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`);
  const sub = data?.data?.[0];
  if (!sub) return null;
  return {
    subscriptionId: sub.id,
    status: sub.status || null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    currentPeriodEnd: sub.current_period_end || null,
    latestInvoiceStatus: sub.latest_invoice?.status || null,
  };
}

