// Canonical Nexus Forge credit pricing. Keep customer-facing copy and
// server-side metering tied to this one policy instead of scattering
// numbers through HTML and API handlers.
export const FORGE_CREDIT_PRICING = Object.freeze({
  freshBuild: 15,
  edit: 2,
  assistant: 1,
  usagePack: Object.freeze({
    // Must match Stripe price price_1UEjoFDh5Di7LYi3DGorrLRb
    // (CREDIT_PACK_PRICE_ID in lib/billingPlans.js), which is live at
    // unit_amount 600. This said 4 while Stripe charged 6, so the API
    // advertised a cheaper pack than customers were actually billed.
    priceUsd: 6,
    credits: 30,
  }),
});

export function publicForgePricing() {
  return {
    freshBuild: FORGE_CREDIT_PRICING.freshBuild,
    edit: FORGE_CREDIT_PRICING.edit,
    assistant: FORGE_CREDIT_PRICING.assistant,
    usagePack: { ...FORGE_CREDIT_PRICING.usagePack },
  };
}
