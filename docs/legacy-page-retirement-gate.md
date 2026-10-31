# Legacy page retirement — compatibility gate (2026-10-30)

## Verified from source
Eight Vercel permanent redirect rules target canonical workspace views:
mission-control, conference-room, memory, queue, connectors, tenants,
nexus-canvas, and thoughtspace.

Eight corresponding HTML files were present when checked on main;
`public/thoughtspace.html` returned 404. Do not recreate the missing
page merely to remove it. Keep its redirect.

The old `public/legacy-route.js` has an additional feature for
`/nexus-space.html#command`, `#conference`, `#builder`,
`#story`, `#memory`, `#queue`, `#connectors`, and `#tenants`.
It maps these to individual workspace views in browsers that load the
legacy HTML. `/nexus-space.html` deliberately has no Vercel edge redirect: edge routing
cannot see URL fragments. Its synchronous browser fallback preserves the
historical fragment selection, including standalone builder and Story Studio
destinations. Keep this behavior when retiring other legacy markup.

## Retiring legacy markup safely
1. Keep all eight Vercel redirects; they protect existing bookmarks.
2. Capture the generated surface-audit report and inspect source references,
   service workers, deep links, analytics and external links before deleting.
3. Verify destination views work for owner and customer permissions on preview.
4. Resolve Nexus Space fragment compatibility or explicitly accept its
   behavior before deleting `nexus-space.html` or its fallback.
5. Remove one confirmed-obsolete group per PR and run all contract tests.
6. Never remove APIs, webhooks, cron endpoints, agent tools, or auth routes
   based only on a static no-reference count.

## Retirement batch 2: Queue, Connectors, Tenants
Replaces only these three redirected HTML screens with small compatibility
pages. Their URLs, existing edge redirects, shared browser fallback, and
canonical workspace destinations remain. Each page includes a plain link
if JavaScript is disabled or the redirect script is unavailable.

Source review: all three old screens loaded legacy-route.js synchronously
before their obsolete UI. Repository code search found links and route
contracts referencing the URLs; retaining the files preserves those callers.
public/service-worker.js uses network-first navigation and precaches only
offline.html, manifest.webmanifest and app-icon.svg; none of these screens
are in its shell list. External bookmarks cannot be inventoried here, so
both redirect layers and a manual fallback are retained.

Nexus Space, shared scripts/styles, APIs, crons, auth, and Forge operator
screens remain outside this removal batch. Surface-audit CI captures the
full source/reference and route inventories. Browser coverage exercises
redirects at phone/desktop sizes and manual links with JavaScript disabled.

