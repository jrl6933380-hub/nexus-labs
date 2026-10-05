// lib/forge/fundedAccess.js
//
// One place that answers: may this request spend OUR money?
//
// Background. Forge began customer-powered — every build ran on a Brain
// the customer connected and paid for, so Forge never funded inference
// and never needed to ask this question. That model has one problem it
// cannot solve: onboarding. A customer has to go create an account with
// a model provider before Forge does anything useful, and free provider
// tiers turned out to be far too rate-limited to carry a product
// experience anyway.
//
// So Free becomes platform-funded: we mint a spend-capped key per
// customer and pay for their first builds. That is a real cost per
// signup, which means three gates, all enforced here rather than
// scattered across the request path:
//
//   1. A connected Brain always wins. If the customer brought their own
//      key, nothing here applies and nothing is metered — that path
//      costs us nothing and should stay the fastest one.
//   2. The funded route requires a CONFIRMED email. This is the gate
//      that makes scripted signups expensive; without it, per-account
//      limits bound each account but not the number of accounts.
//   3. Every funded request is metered before the model call, against
//      the per-account daily pool AND the platform-wide ceiling that
//      lib/roomMetering.js already implements.
//
// Deliberately safe when unconfigured: with no platform key set, the
// funded route reports itself unavailable rather than falling through
// to some other funding source. "Not turned on yet" must never
// accidentally become "billed to whatever key is lying around."

import { isEmailVerified } from '../roomAuth.js';
import { hasOwnBrain } from './brainStream.js';

/** Reasons a funded build can be refused. Each maps to customer-facing copy. */
export const FUNDED_DENIED = Object.freeze({
  NOT_CONFIGURED: 'funded_not_configured',
  EMAIL_UNVERIFIED: 'funded_email_unverified',
  DAILY_EXHAUSTED: 'funded_daily_exhausted',
  PLATFORM_CEILING: 'funded_platform_ceiling',
});

/**
 * Whether platform funding is switched on at all. Reads the key's
 * presence only — the key itself never leaves the server, and no
 * caller of this module ever receives key material.
 */
export function fundedTierConfigured() {
  return Boolean(process.env.FORGE_PLATFORM_OPENROUTER_KEY);
}

/**
 * Decides how a request should be powered, before any model call.
 *
 * Returns one of:
 *   { mode: 'byo' }                        — customer's own Brain, unmetered
 *   { mode: 'funded' }                     — our key, must be metered by caller
 *   { mode: 'denied', reason, message }    — cannot proceed
 */
export async function resolveBuildFunding(username, { checkOwnBrain = hasOwnBrain } = {}) {
  // 1. A connected Brain always wins. Checked first so a customer who
  //    brought their own key is never blocked by our verification or
  //    our budget — neither has anything to do with their key.
  if (username && await checkOwnBrain(username).catch(() => false)) {
    return { mode: 'byo' };
  }

  if (!fundedTierConfigured()) {
    return {
      mode: 'denied',
      reason: FUNDED_DENIED.NOT_CONFIGURED,
      message: 'Connect a Builder Brain to start building.',
    };
  }

  if (!username) {
    return {
      mode: 'denied',
      reason: FUNDED_DENIED.EMAIL_UNVERIFIED,
      message: 'Sign in to start building.',
    };
  }

  // 2. Confirmed email, or no funded access. Phrased as a next step
  //    rather than a rejection, and the resend path is one tap away.
  if (!await isEmailVerified(username).catch(() => false)) {
    return {
      mode: 'denied',
      reason: FUNDED_DENIED.EMAIL_UNVERIFIED,
      message: 'Confirm your email to start building — check your inbox for the link, or resend it from your account.',
    };
  }

  return { mode: 'funded' };
}

/**
 * Turns a metering rejection into customer-facing copy.
 *
 * Both cases are OUR budget, not the customer's fault, so neither
 * should read like an error they caused or a bug in the product. The
 * daily case is the designed shape of the free tier (a bounded
 * allowance that refills), and the platform case is a safety ceiling
 * they happened to arrive behind.
 */
export function fundedMeterMessage(reason) {
  if (reason === 'daily_budget_exhausted') {
    return {
      reason: FUNDED_DENIED.DAILY_EXHAUSTED,
      message: "You've used today's free building. It refills tomorrow — or connect your own Builder Brain to keep going now.",
    };
  }
  if (reason === 'global_ceiling_exceeded') {
    return {
      reason: FUNDED_DENIED.PLATFORM_CEILING,
      message: 'Forge is unusually busy right now. Try again shortly, or connect your own Builder Brain to skip the queue.',
    };
  }
  return {
    reason: FUNDED_DENIED.DAILY_EXHAUSTED,
    message: "You've used your free building for now. Connect your own Builder Brain to keep going.",
  };
}
