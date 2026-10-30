# Nexus owner navigation — baseline before consolidation

Status: inventory/contract only, **no pages retired**.

## Canonical owner destinations

- Owner inbox and entry point: `/workspace.html?view=messages`
- Operations and agent board: `/workspace.html?view=deck`
- Agent roster: `/workspace.html?view=agents`
- Approvals: `/workspace.html?view=approvals`
- Forge management: `/workspace.html?view=forge`
- Forge builder: `/forge.html`
- Workbench projects: `/workspace.html?view=workbench`
- Story Studio: `/story-studio.html` and workspace `view=story`
- Memory: `/workspace.html?view=memory`
- Nexus Phone: `/workspace.html?view=phone`
- Nexus Lab: `/workspace.html?view=lab`

The owner auth gate is in `public/workspace.html`. Do not replace it with public navigation or expose the underlying owner tools to customers.

## Cleanup rules

1. Preserve direct links and bookmarks (including Nexus Space hash destinations) before removing any old HTML.
2. Investigate the browser fallback and the Vercel edge redirect together: URL fragments are not sent to the edge.
3. Check API callers, cron jobs, embedded views and external links before declaring a file unused.
4. Keep the independent Android Phone companion and experimental Local AI lab distinct; do not conflate the local model with Qwen in the cloud.
5. Avoid deleting UI assets merely because the corresponding screen redirects; other pages may import them.
6. Run `node --test tests/owner-route-contract.test.mjs tests/nexus-space-anchors.test.mjs` before navigation changes.

## Next cleanup batch

Audit actual entry points in the owner Messages home and Forge, record reachable vs orphaned surfaces, then propose narrow navigation adjustments separately from deletions. This contract does not certify any surface as safe to remove.
