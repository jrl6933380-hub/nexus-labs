// lib/forgeProgram.js
// Single source of truth for the Forge caller program's business rules:
// tier pricing, edit allowances, commission math, the cancel/win-back
// timeline, and batch limits. Pure functions only -- no I/O -- so every
// money rule is unit-tested and the API routes just call these.
//
// Decisions (Mr. Lopez, 2026-09-25):
//  - Tiers: Basic $29 / Standard $49 / Plus $79 per month.
//  - Edits via Support Nex: Basic 1/mo, Standard 3/mo, Plus unlimited minor.
//  - Top-up: $10 buys 3 extra edits. Top-ups are NOT commissioned.
//  - AI assistant widget: included in Plus, paid add-on for other tiers.
//  - Signup bonus by tier ($10/$20/$35, per-caller overridable) + 15%
//    of every paid invoice to the client's commission_owner.
//  - Upgrade bonus: $10 per tier jumped, to whoever closed the upgrade.
//  - Reactivation: same tier or lower, no new signup bonus.
//  - Cancel: 3-day live grace -> placeholder -> single follow-up call on
//    day 14 -> no/no-answer = taken down.
//  - Draft generation batches capped at 5.

const DAY_MS = 24 * 60 * 60 * 1000;

export const TIERS = Object.freeze({
  basic:    Object.freeze({ rank: 1, priceCents: 2900, editsPerMonth: 1,        aiAssistant: false }),
  standard: Object.freeze({ rank: 2, priceCents: 4900, editsPerMonth: 3,        aiAssistant: false }),
  plus:     Object.freeze({ rank: 3, priceCents: 7900, editsPerMonth: Infinity, aiAssistant: true  }),
});

export const TOPUP = Object.freeze({ priceCents: 1000, edits: 3 });
export const GRACE_DAYS = 3;
export const FOLLOWUP_DAYS = 14;
export const MAX_BATCH = 5;

export function tierOf(tier) {
  const found = TIERS[tier];
  if (!found) throw new Error(`Unknown tier: ${tier}`);
  return found;
}

// caller = a forge_callers row (numeric columns arrive as strings).
export function signupBonusCents(caller, tier) {
  tierOf(tier);
  return Math.round(Number(caller[`signup_bonus_${tier}`]) * 100);
}

export function recurringCommissionCents(caller, amountPaidCents) {
  if (!(amountPaidCents > 0)) return 0;
  return Math.round(amountPaidCents * Number(caller.recurring_pct));
}

export function upgradeBonusCents(caller, fromTier, toTier) {
  const jumps = tierOf(toTier).rank - tierOf(fromTier).rank;
  return jumps > 0 ? Math.round(jumps * Number(caller.upgrade_bonus) * 100) : 0;
}

export function editsRemaining({ tier, allotmentUsedThisMonth = 0, topupGranted = 0, topupUsed = 0 }) {
  const allotment = tierOf(tier).editsPerMonth;
  if (allotment === Infinity) return Infinity;
  return Math.max(0, allotment - allotmentUsedThisMonth) + Math.max(0, topupGranted - topupUsed);
}

export function cancelTimeline(cancelRequestedAt) {
  const t = new Date(cancelRequestedAt).getTime();
  if (Number.isNaN(t)) throw new Error('Invalid cancel date.');
  return {
    placeholderAt: new Date(t + GRACE_DAYS * DAY_MS),
    followupDueAt: new Date(t + FOLLOWUP_DAYS * DAY_MS),
  };
}

export function reactivationTiers(previousTier) {
  const rank = tierOf(previousTier).rank;
  return Object.keys(TIERS).filter((key) => TIERS[key].rank <= rank);
}

export function validateBatch(leadIds) {
  const unique = [...new Set((leadIds || []).filter(Boolean))];
  if (!unique.length) throw new Error('Pick at least one lead.');
  if (unique.length > MAX_BATCH) throw new Error(`Batches are capped at ${MAX_BATCH} leads.`);
  return unique;
}
