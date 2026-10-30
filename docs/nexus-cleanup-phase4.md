# Cleanup phase 4 — first retired static page

## Removed
- `public/thoughtspace.html` was obsolete duplicate markup. Vercel already permanently redirects `/thoughtspace.html` to `/workspace.html?view=messages`.

## Preserved
- The permanent redirect in `vercel.json`, canonical workspace, browser fallback mapping, all APIs and agent workflows.
- All other old HTML pages, pending additional dependency checks.

## Evidence and constraints
- Repository code search for `thoughtspace.html` found the redirect, browser fallback and generic E2E page crawler; no identified active feature linking to this page.
- Existing E2E accessibility suite discovers HTML files automatically, so retiring the old file removes that duplicate page from the sweep.
- New route contract protects the old URL.
- `nexus-space.html` is NOT removed: legacy hash actions and tests indicate extra behavior, requiring a separate migration decision.
- External bookmarks and traffic remain unmeasured. Production redirect response must be smoke-tested after deployment.

## Follow-up
Run route inventory and integration checks; review remaining redirected pages individually before removing markup. Verify owner Home destinations before consolidating navigation. No public API, cron, MCP or phone behavior should be removed by this cleanup.
