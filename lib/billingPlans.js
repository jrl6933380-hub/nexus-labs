// lib/billingPlans.js
// Single source of truth mapping Stripe Price IDs to what they mean
// inside Nexus Forge, so api/checkout.js and api/webhooks/stripe.js
// read from one place instead of duplicating price IDs.

import {FORGE_CREDIT_PRICING} from './forgePricing.js';
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
export const CREDIT_PACK_CREDITS = FORGE_CREDIT_PRICING.usagePack.credits;

// Site Agent: a project-scoped add-on (embedded assistant on a
// published site), not an account-wide plan — checkout for these
// requires a projectId, unlike the account plans above.
export const SITE_AGENT_PRICE_IDS = new Set(['price_1UElHMDh5Di7LYi31nzqKcEH', 'price_1UElHRDh5Di7LYi3ngR1WN8S']);
export const SITE_AGENT_MONTHLY_LIMIT = 500;
export const SITE_AGENT_REPLY_PACK_PRICE_ID = 'price_1UElHWDh5Di7LYi3AOzJbjRa';
export const SITE_AGENT_REPLY_PACK_REPLIES = 200;

// Tells api/checkout.js how to set up the Checkout Session, and
// api/webhooks/stripe.js what to do once it's paid — mode + what
// metadata to carry through to the completed session.
export function resolveCheckoutPrice(priceId) {
  if(priceId==='nexus_pro_monthly')return {mode:'subscription',kind:'plan',plan:PLANS.HOSTED,amountCents:1000,label:'Nexus Pro'};
  if(priceId==='nexus_plus_monthly')return {mode:'subscription',kind:'plan',plan:PLANS.GROWTH,amountCents:2000,label:'Nexus Plus'};
  if (priceId === CREDIT_PACK_PRICE_ID) {
    return { mode: 'payment', kind: 'credit_pack', credits: CREDIT_PACK_CREDITS };
  }
  if (priceId === SITE_AGENT_REPLY_PACK_PRICE_ID) {
    return { mode: 'payment', kind: 'site_agent_reply_pack', replies: SITE_AGENT_REPLY_PACK_REPLIES };
  }
  if (SITE_AGENT_PRICE_IDS.has(priceId)) {
    return { mode: 'subscription', kind: 'site_agent', monthlyLimit: SITE_AGENT_MONTHLY_LIMIT };
  }
  const sub = SUBSCRIPTION_PLANS[priceId];
  if (sub) return { mode: 'subscription', kind: 'plan', plan: sub.plan };
  return null;
}

// Called only after Stripe signature verification. Fulfillment must survive webhook retries.
export async function fulfillUsagePack(session,meter){
 if(session.metadata?.kind!=='credit_pack'||session.payment_status!=='paid')return false;
 const user=session.metadata?.username||session.client_reference_id;
 if(!user||!session.id||session.currency!=='usd'||session.amount_total!==600)throw new Error('Usage pack payment does not match the product');
 await meter.grantBonusCredits(user,CREDIT_PACK_CREDITS,{purchaseId:session.id});return true;
}
