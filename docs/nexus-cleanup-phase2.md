# Nexus Cleanup — Phase 2: evidence and entry points

This PR changes **no customer routes, menus, API endpoints or production documents**. It adds repeatable audit checks and an initial registry of canonical screens.

## Running the audit
A GitHub Actions workflow, **Nexus surface audit**, triggers on relevant PR changes and can be launched manually in the Actions tab. It runs the baseline audit script already merged via #836, verifies the legacy Vercel redirect contract, writes a GitHub job summary, and uploads the complete JSON report as an artifact.

### Reading the output
- `redirected-review-only`: likely candidate for removing an obsolete HTML file **only after** reference validation.
- `unreferenced-investigate`: string scan found no references, not evidence of no traffic.
- `referenced-keep-until-verified`: something in source references the path.

### First review batch
`mission-control.html`, `conference-room.html`, `memory.html`, `queue.html`, `connectors.html`, `tenants.html`, `nexus-canvas.html`, `thoughtspace.html`, `nexus-space.html`.

These all have redirects configured, but their HTML may still be referenced by other scripts, tests, cached service workers, and external bookmarks. Keep Vercel redirects permanently for backward compatibility.

### Navigation policy
Use existing `workspace.html` and `nexus-navigation.js` as canonical navigation. The registry is informational rather than a second navigation implementation. Owner Home should expose Forge, agent board, media and Ad Maker, phone and future Local AI with a single stable entry per feature.

### Not yet done
No full report is claimed until GitHub Actions completes. Registry routes are manually reviewed starting points, not evidence that all UI screens work. Physical TCL signing, model packages, customer journeys and remote integrations are explicitly out of scope.

### Next PR after report
Review exact references for each of the nine redirects, test canonical destinations in production/preview, then remove only proven-obsolete markup in small reversible groups. No API/agent/webhook deletion in this phase.
