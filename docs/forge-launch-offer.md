# Forge caller launch offer — review before deployment

## New-customer offer (2026-11-06)
- **$20 total at signup**, including the first month: $10 one-time activation + $10 first month's website/hosting.
- **$10/month starting with the next billing cycle**.
- **Unlimited website edits during the launch promotion**; no automated expiry date or usage cap. Owner will explicitly decide when and how this promotional perk changes. Do not claim a fixed length or silently stop honoring it.
- This applies to **new Forge caller-led clients only**. It does not rewrite the separate waitlist funnel, Nexus Workbench subscriptions, or any existing Forge subscription.

## Billing, commissions and legacy protections
- Legacy Basic ($29), Standard ($49) and Plus ($79) Stripe prices remain in code for old clients. Do not alter them in Stripe.
- The new `launch` tier stores a $10 recurring monthly amount and has unlimited edit allowance.
- Checkout uses Stripe subscription mode with one recurring `price_data` item ($10/mo) and one one-time `price_data` item ($10 activation). The one-time item appears on the first invoice only; **first charge should be $20**, later monthly charge $10, excluding any applicable taxes.
- The existing 15% caller commission on paid invoice totals remains. The new launch signup bonus defaults to $0 until the owner sets `forge_callers.signup_bonus_launch`. Do not silently borrow legacy $10/$20/$35 bonus amounts.
- Upgrading or downgrading between launch and legacy commercial terms is blocked; an explicit Stripe billing migration will be needed.

## Required deployment sequence
1. Apply `neon/migrations/0002_forge_launch_offer.sql` in the authenticated production Neon database, and separately in the test database if used. Verify the new check constraint accepts `launch`, previous tiers still work and the new commission column defaults to 0. **Merging code without this migration causes signup creation to fail**.
2. Run `node --test test/forgeProgram.test.mjs test/forge-pitch.test.mjs test/forge-launch-checkout.test.mjs` and the caller Playwright tests for phone and desktop, then review CI.
3. Confirm Stripe webhook `invoice.paid` updates the correct Forge client on both first and recurring invoices. Use **Stripe test mode only** to verify $20 upfront, $10 recurring, zero double charges on retries, and no unexpected setup-fee renewals.
4. Deploy the changed API and caller UI only after migration and tests. Check live page shows **one Launch offer**, no retired tier pricing, and agrees with Stripe before sharing any payment link.
5. Verify existing subscriptions and MRR unchanged, and record the promotion's later end policy with the owner before any adjustment.

This PR intentionally does **not** migrate existing paying customers, contact prospects, send payment links, create real Stripe subscriptions, or choose an end date for the offer.
