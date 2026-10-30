# Legacy page retirement — compatibility gate (2026-10-30)

## Verified from source
Nine Vercel permanent redirect rules target canonical workspace views:
mission-control, conference-room, memory, queue, connectors, tenants,
nexus-canvas, thoughtspace, and nexus-space.

Eight corresponding HTML files were present when checked on main;
`public/thoughtspace.html` returned 404. Do not recreate the missing
page merely to remove it. Keep its redirect.

The old `public/legacy-route.js` has an additional feature for
`/nexus-space.html#command`, `#conference`, `#builder`,
`#story`, `#memory`, `#queue`, `#connectors`, and `#tenants`.
It maps these to individual workspace views in browsers that load the
legacy HTML. The Vercel edge redirect sends `/nexus-space.html` to
`/workspace.html?view=messages` and *cannot see URL fragments*.
Consequently the edge path may not preserve the historical fragment
selection. This is a compatibility risk to investigate, not proof that
the current production navigation is broken.

## Retiring legacy markup safely
1. Keep all nine Vercel redirects; they protect existing bookmarks.
2. Capture the generated surface-audit report and inspect source references,
   service workers, deep links, analytics and external links before deleting.
3. Verify destination views work for owner and customer permissions on preview.
4. Resolve Nexus Space fragment compatibility or explicitly accept its
   behavior before deleting `nexus-space.html` or its fallback.
5. Remove one confirmed-obsolete group per PR and run all contract tests.
6. Never remove APIs, webhooks, cron endpoints, agent tools, or auth routes
   based only on a static no-reference count.

## This PR
Adds read-only test coverage of browser fallback parity and historical
fragment mapping, wired into the existing audit workflow. It does not
remove files or change any runtime routing.
