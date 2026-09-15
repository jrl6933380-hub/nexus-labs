---
name: forge-domain
description: What Nexus Forge actually is and how its three surfaces (Builder, Field, Ops) and live billing fit together — so "is Forge ready?" gets answered specifically and from current code/deploy state, not from one stale Board task.
triggers: forge, forge builder, forge field, forge ops, room builder, billing, stripe, checkout, is forge ready
---
Nexus Forge is a business, not a page. It's the caller-led website sales operation: workers get qualified local-business leads, review the business, open a pre-generated replacement site, use a tailored pitch, call the prospect, and log the outcome. It spans three distinct surfaces — never answer "is Forge ready?" without saying which one is meant:

- Forge Builder (`/room.html`) — the build tool. Create and live-edit a site/room/tool. Formerly called "Room Builder"; same page, renamed. Internal slug is still `room-builder` and URL is still `/room.html` — load-bearing, unchanged.
- Forge Field (`/forge-caller.html`) — the worker workspace: assigned leads, business intel, site preview, pitch guide, tap-to-call, outcome logging.
- Forge Ops (`/forge-dashboard.html`) — the operator/manager view: customer accounts, plans, usage, billing status, granting credits.

Billing is live, not theoretical. There is a real Stripe account ("Nexus OS") and real server-side code: `api/checkout.js` creates live Checkout Sessions for plan upgrades and credit packs (auth-gated, price resolution via `lib/billingPlans.js`, project-scoped purchase validation), `api/billing-portal.js` handles customer billing management, `api/webhooks/stripe.js` handles Stripe events. Old task notes claiming billing is "not yet wired" are out of date — do not repeat that phrasing. If asked about billing specifics, check the actual code and the Stripe account, not a cached claim.

The Board task "New venture: Nexus Forge" is a product-direction write-up, not a unit of work — its status sitting at "testing" is not a readiness signal. Real Forge planning lives in the venture's own room (`/canvas.html?id=nexus-forge`): Upgrades, Profitability, Marketing, Developer View sections are real and readable/contributable.

The standing lesson behind all of this: a Board task's `result` field is a snapshot of what was true when written, not current state. Verify readiness claims against live code, the live Stripe account, or the live deployment — never against a task result alone.

This skill is domain knowledge only. It does not grant tools, credentials, approvals, deployment authority, or permission to change billing/checkout code — those changes still need their own branch, tests, and PR review given they touch billing.

Nex has two read tools for real-time Forge visibility, not just this static domain description: `list_forge_customers` (every account — plan, usage, live Stripe billing status, same data as the Ops dashboard) and `list_forge_escalations` (every Build Team ticket in flight, with status, so you don't need a specific escalation id handed to you). Follow up with `get_forge_escalation` for a ticket's full request text, or `get_tunneled_pipeline` for lane-by-lane build detail. `submit_pipeline_lane_result` and `submit_pipeline_review` let you actually step into a stuck build — take over a lane yourself with your normal repo tools, then submit real evidence — rather than only watching from the outside.
