# Nexus Forge

**Status:** active
**Last updated:** see memory/Board for latest — this file is a seed, fill in as work continues
**Repo(s):** jrl6933380-hub/nexus-labs
**Related Board task ids:** see "New venture: Nexus Forge" task (spec doc, not a work item)
**Related venture canvas:** /canvas.html?id=nexus-forge

## What this is
Caller-led website sales operation. Three surfaces: Forge Builder (/room.html, build/live-edit a site), Forge Field (/forge-caller.html, worker workspace for calling leads), Forge Ops (/forge-dashboard.html, operator/manager view — accounts, plans, billing).

## Current status
Billing is live and real: Stripe account "Nexus OS", api/checkout.js, api/billing-portal.js, api/webhooks/stripe.js all wired. Several features shipped (hamburger builder menu, post-signup subscription tiers, live build credits, permanent credit pricing). Do not treat the old "billing not yet wired" note from 2026-09-12 as current — it's stale.

## Key decisions
- Nex holds a bounded self-service Forge account (nex-forge-manager, forge_manager role) for direct testing/admin — see nex-skills/forge-manager/SKILL.md for the exact boundary.

## Open questions / blockers
- 

## Links
- PRs: #306, #307 (forge-manager skill fixes)
