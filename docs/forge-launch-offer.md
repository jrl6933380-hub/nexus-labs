# Forge caller launch offer — review before deployment

## New-customer offer (2026-11-06)
- **$20 total at signup**, including the first month: $10 one-time activation + $10 first month's website/hosting.
- **$10/month starting with the next billing cycle**.
- **Unlimited website edits during the launch promotion**; no automated expiry date or usage cap. Owner will explicitly decide when and how this promotional perk changes. Do not claim a fixed length or silently stop honoring it.
- This applies to **new Forge caller-led clients only**. It does not rewrite the separate waitlist funnel, Nexus Workbench subscriptions, or any existing Forge subscription.

## Billing, commissions and legacy protections
- Legacy Basic ($29), Standard ($49) and Plus ($79) Stripe prices remain in code for old clients. Do not alter them in Stripe.
- The new `launch` tier stores a $10 recurring monthly amount and has unlimited edit allowance.
- Checkout uses Stripe subscription mode with two reusable price IDs under the Nexus Forge Launch product: one $10 monthly recurring price and one $10 one-time activation price. The one-time item appears on the first invoice only; **first charge should be $20**, later monthly charge $10, excluding any applicable taxes.
- The existing 15% caller commission on paid invoice totals remains. The new launch signup bonus defaults to $0 until the owner sets `forge_callers.signup_bonus_launch`. Do not silently borrow legacy $10/$20/$35 bonus amounts.
- Upgrading or downgrading between launch and legacy commercial terms is blocked; an explicit Stripe billing migration will be needed.

## Stripe catalog (Nexus OS, live account)
- Product: `prod_VZqcgIOXqRPeSH` (Nexus Forge Launch — Website & Hosting)
- Monthly recurring price: `price_1UYgviDh5Di7LYi3j6YxdET5` ($10/month)
- One-time activation price: `price_1UYgvoDh5Di7LYi3Gk7MnuHy` ($10 once)
- Vercel production variables `FORGE_LAUNCH_MONTHLY_PRICE` and `FORGE_LAUNCH_ACTIVATION_PRICE` were created with these IDs. Preview/test must use **separate test-mode price IDs** before its launch flag is enabled.
- Stripe live webhook endpoint `/api/webhooks/stripe` is enabled for `invoice.paid`, subscription updates/deletion, and checkout completion. The account does not currently expose a separate connected Stripe test-mode context through the integration, so a real test-mode Checkout and renewal verification are still pending.
- No live subscription or customer charge was created while setting up prices.

## Safe rollout guard
- `FORGE_LAUNCH_ENABLED` defaults to **off**. Merging is safe with the old 3-tier signup still shown and accepted.
- Only set `FORGE_LAUNCH_ENABLED=true` after the production Neon migration is confirmed and Stripe test-mode charges are verified. Vercel redeploy is required for the environment variable to take effect.
- The API rejects a new launch-tier signup while the flag is off. With it on, new leads may select only Launch. Older subscribers keep their plans.

## Required deployment sequence
1. Apply `neon/migrations/0002_forge_launch_offer.sql` in the authenticated production Neon database, and separately in the test database if used. Verify the new check constraint accepts `launch`, previous tiers still work and the new commission column defaults to 0. **Merging code without this migration causes signup creation to fail**.
2. Run `node --test test/forgeProgram.test.mjs test/forge-pitch.test.mjs test/forge-launch-checkout.test.mjs` and the caller Playwright tests for phone and desktop, then review CI.
3. Confirm Stripe webhook `invoice.paid` updates the correct Forge client on both first and recurring invoices. Create **test-mode** price IDs (distinct from the live IDs above), configure them in preview, and use Stripe test mode to verify $20 upfront, $10 recurring, zero double charges on retries, and no unexpected setup-fee renewals.
4. Deploy changes with the launch flag **off**, which retains the legacy signup path. After migration and Stripe tests, enable `FORGE_LAUNCH_ENABLED=true` and redeploy. Check live page shows **one Launch offer**, no retired tier pricing, and agrees with Stripe before sharing any payment link.
5. Verify existing subscriptions and MRR unchanged, and record the promotion's later end policy with the owner before any adjustment.

This PR intentionally does **not** migrate existing paying customers, contact prospects, send payment links, create real Stripe subscriptions, or choose an end date for the offer.
