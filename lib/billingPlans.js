// lib/billingPlans.js
// Single source of truth mapping Stripe Price IDs to what they mean
// inside Nexus Forge, so api/checkout.js and api/webhooks/stripe.js
// read from one place instead of duplicating price IDs.

import { PLANS } from './roomAuth.js';

// Subscription tiers: monthly + annual price for each paid plan.
// Annual is priced at 10x monthly ("2 months free").
export const SUBSCRIPTION_PLANS = Object.freeze({
  price_1UEjnpDh5Di7LYi3L6SfmKOu: { plan: PLANS.HOSTED, interval: 'month' },
  price_1UEjnvDh5Di7LYi3Mk6MpnmX: { plan: PLANS.HOSTED, interval: 'year' },
  price_1UEjnzDh5Di7LYi3LDjvkHQY: { plan: PLANS.GROWTH, interval: 'month' },
  price_1UEjo3Dh5Di7LYi33tCAb4W8: { plan: PLANS.GROWTH, interval: 'year' },
  price_1UEjo7Dh5Di7LYi3fAAwsqmy: { plan: PLANS.UNLIMITED, interval: 'month' },
  price_1UEjoBDh5Di7LYi3O69yUjQS: { plan: PLANS.UNLIMITED, interval: 'year' },
});

// One-time top-up: not a plan change, just extra build credits on top
// of whatever plan the account is already on.
export const CREDIT_PACK_PRICE_ID = 'price_1UEjoFDh5Di7LYi3DGorrLRb';
export const CREDIT_PACK_CREDITS = 30;

// Tells api/checkout.js how to set up the Checkout Session, and
// api/webhooks/stripe.js what to do once it's paid — mode + what
// metadata to carry through to the completed session.
export function resolveCheckoutPrice(priceId) {
  if (priceId === CREDIT_PACK_PRICE_ID) {
    return { mode: 'payment', kind: 'credit_pack', credits: CREDIT_PACK_CREDITS };
  }
  const sub = SUBSCRIPTION_PLANS[priceId];
  if (sub) return { mode: 'subscription', kind: 'plan', plan: sub.plan };
  return null;
}
