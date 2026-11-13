# Forge launch status (single source of truth)

**Every agent: read this file before starting Forge work, and update it in the same PR as your work.**
It lives in GitHub on purpose. The Agent Board and Timeline need the database, and this file works when the database is down.
Never put secrets or passwords in this file.

Goal: Justin's callers start calling Monday 2026-11-16. Callers pitch a demo and sign clients up. We build the final sites. Customers never sign in.

Last updated: 2026-11-13 by Claude.

## DONE and merged
- Lead list, call buttons, dispositions, follow-ups.
- Three demo looks per lead, with real stock photos added automatically (#949). Pixabay only; no Pexels key yet.
- One private swipeable demo link per lead, with no login (#942). Callers can edit a demo in a step-by-step guide (#948).
- Pricing: $50 today (includes first month), then $25/mo (#943). Owner can change it in Forge Ops "Launch price" (#944).
- Caller photo finder (#945, #946).
- Build queue: caller taps "Send to build" with the picked look and notes; Ops sees it (#949).
- Customer support, no login (#950): private support link, `/support.html`, Ops "Support inbox", support link on the thank-you page and in finished-site footers.
- Going live: Ops asks for the live link, emails the customer if an email is on file, and shows a "Text customer" button (#950).
- Agent Board Timeline (#947).

## VERIFIED LIVE (tested on the real site)
- Demo link, caller edit permissions, pricing shown in the pitch, price change locked to managers.

## MERGED BUT NOT TESTED LIVE
1. Stock photos on the demo looks.
2. Build queue "PAID" label.
3. Support page, support inbox, "Copy support link".
4. "Text customer" and the live email.
5. Support link in the finished-site footer (needs `supportUrl` passed when the final site is built).

## BLOCKED right now
- Neon database is on the free plan and has run out of compute hours, so the whole site is down. Fix: Justin upgrades to Launch at console.neon.tech (project NexusOS). After that, slow the every-minute background jobs to cut cost.

## TO DO before Monday
1. Upgrade Neon, then confirm the site and the Agent Board are back.
2. Confirm the Vercel setting `FORGE_LAUNCH_ENABLED` is `true`. If not, payment links would charge the old $29/$49/$79 tiers instead of $50/$25.
3. Run the live test as caller01: lead, 3 looks with photos, demo link, payment link, thank-you page, Build queue, support message, mark live.
4. Make sure Stripe is in live mode, not test mode.
5. One practice call with a friend as the customer.
6. Slow the background jobs (they keep the database awake all day and cost money).

## KNOWN GAPS (not blocking)
- Email may not reach real customers until a sending domain is set in Resend (`RESET_EMAIL_FROM`). The "Text customer" button is the reliable route.
- AI edit ("edit" action in api/forge-site.js) returns 500 because no AI provider is available. Callers use the guided editor instead.
- No Pexels API key, so the photo finder has fewer choices.
- Final-site builds must pass `supportUrl` (from Ops "Copy support link") for the footer link to appear.
- Iowa telemarketing / do-not-call compliance is Justin's responsibility.

## HALF-FINISHED THINGS
- Ally Qwen tasks from earlier in the project: not finished.
- `forge-reset` page removal: not done.
- First `[TIMELINE]` board post for this work: not posted, because the board is down.

## HOW TO UPDATE
Move items between sections as they change. Put the PR number next to anything you finish. Keep each line short.
