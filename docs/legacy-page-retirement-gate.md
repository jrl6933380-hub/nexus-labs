# Legacy page retirement — compatibility gate (2026-10-30)

## Verified from source
Eight Vercel permanent redirect rules target canonical workspace views:
mission-control, conference-room, memory, queue, connectors, tenants,
nexus-canvas and thoughtspace. Nexus Space is an intentional exception:
it must load its browser-side compatibility script to read URL fragments.

Eight corresponding HTML files were present when checked on main;
`public/thoughtspace.html` returned 404. Do not recreate the missing
page merely to remove it. Keep its redirect.

The old `public/legacy-route.js` has an additional feature for
`/nexus-space.html#command`, `#conference`, `#builder`,
`#story`, `#memory`, `#queue`, `#connectors`, and `#tenants`.
It maps these to individual workspace views when the legacy HTML loads.
The former Vercel edge redirect could not read URL fragments, so this PR
removes only the `/nexus-space.html` edge redirect and preserves its HTML
entry and browser fallback. All other eight legacy redirects stay unchanged.
Previously cached permanent redirects in some browsers may still bypass the
new behavior; verify with fresh browser sessions and existing bookmarks.

## Retiring legacy markup safely
1. Keep eight Vercel redirects and the Nexus Space browser compatibility entry; both protect existing bookmarks.
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
