# Nexus cleanup phase 3 — protect non-visual routes

This phase makes hidden deployment dependencies visible *before* any markup retirement.

## What is added
- `scripts/audit-route-dependencies.mjs`: read-only JSON inventory of Vercel redirects, rewrites, cron schedules, and function configuration; highlights missing local targets for investigation, not automatic deletion.
- `test/route-dependency-contract.test.mjs`: regression tests for scheduled API entry points, OAuth routes, and canonical workspace destinations.
- Existing routes, API handlers, owner navigation, customer UI, and phone integration remain unchanged.

## Follow-up review batches
1. Run the surface and dependency inventories and inspect reports from GitHub Actions.
2. For the nine legacy page files, inspect direct references, service-worker caching, external consumers, and whether the target workspace view is actually implemented.
3. Remove only verified-redundant HTML in small reversible PRs, retaining edge redirects.
4. Consolidate owner Home links only after the feature registry's destinations are validated.
5. Treat API handlers, crons, OAuth, MCP, device services, and wake triggers as protected until separately tested.

**Important:** Files in `public` that are under a Vercel redirect may never be served through that URL, but are not automatically safe to remove. This audit does not claim to measure traffic or find every dynamic caller.
