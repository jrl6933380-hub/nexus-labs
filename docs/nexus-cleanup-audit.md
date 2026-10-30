# Nexus Cleanup & Consolidation — Phase 1 audit

**Status:** read-only inventory started October 30, 2026. No runtime, route, database, model, or deployed phone changes proposed here.

## Baseline from repository
First-level directory listing on main shows 176 public entries, 82 api entries, and 251 lib entries (not recursive file totals). `public/nexus-navigation.js` already bundles Life & Schedule, Projects, and Operations. `public/nexus-shell.js` explicitly notes removal of obsolete hash navigation. This means a unified-navigation effort already exists — extend it rather than introduce another shell.

`vercel.json` currently redirects these older operator URLs into the canonical workspace:

| Retired public URL | Current destination | First classification |
|---|---|---|
| /mission-control.html | /workspace.html?view=deck | Redirected — investigate |
| /conference-room.html | /workspace.html?view=agents | Redirected — investigate |
| /memory.html | /workspace.html?view=memory | Redirected — investigate |
| /queue.html | /workspace.html?view=approvals | Redirected — investigate |
| /connectors.html | /workspace.html?view=skills | Redirected — investigate |
| /tenants.html | /workspace.html?view=forge | Redirected — investigate |
| /nexus-canvas.html | /workspace.html?view=messages | Redirected — investigate |
| /thoughtspace.html | /workspace.html?view=messages | Redirected — investigate |
| /nexus-space.html | /workspace.html?view=messages | Redirected — investigate |

A second compatibility layer lives in `public/legacy-route.js`. Retain redirects for old links even if their document files are ultimately removed.

## Inventory automation
Run `node scripts/audit-surfaces.mjs /tmp/nexus-surface-audit.json` on a checked-out repository. It reports HTML pages, references (string heuristic), Vercel redirects and file counts without any mutations. **Unreferenced is not equivalent to safe to delete**. Confirm runtime nav, computed imports, service-worker cache, external links, user bookmarks, tests, and API flows.

## Work order
1. Enumerate canonical owner screens, customer screens, Forge tools, agent boards, Android phone tools, and public campaign paths. Record roles, entry points, auth boundary, owner, dependencies, and live usage evidence.
2. Validate redirected page candidates with actual route/browser smoke tests and code reference search. Retain compatibility redirect destinations.
3. Build feature registry with `id`, canonical route, category, status (production/labs/legacy), permissions, owner-nav destination, upstream/downstream dependencies and rollback route. **Every new feature must get a home**.
4. Create separate, small PRs: navigation adjustments first; retired markup second; dormant APIs only with consumer and webhook analysis; dead library code only after explicit import and tests review.
5. Keep cleanup independent from FunctionGemma PR #835 and preserve the signed phone APK, Qwen pod, billing, OAuth, Stripe webhooks, MCP integrations, and waitlist triggers.

## Guardrails
- Never delete APIs, cron jobs, external webhook endpoints, OAuth routes, integration tools or database tables based only on lack of UI references.
- Do not merge destructive changes during this audit.
- Require route smoke tests, existing unit tests, owner acceptance and a rollback plan before any removal PR.
- Screens that are still useful but not frequently accessed should be moved into owner-only Labs rather than removed.
- Do not log private customer content while measuring page use.

## Initial recommendations (not yet implemented)
- Preserve `/workspace.html` as canonical owner entry and reuse existing navigation bundles.
- Prefer a single Owner Home hub for Forge, AI systems, agent boards, Media / Ad Maker, Nexus Phone and Labs.
- Begin manual review with the nine redirected legacy document files, not with the 82 API entries.
- Establish links to each capability from Owner Home and a feature registry before removing duplicated doors.
