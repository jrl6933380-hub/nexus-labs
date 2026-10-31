# Owner Home navigation consolidation — first coverage pass

Run `node scripts/audit-owner-navigation.mjs` to compare the canonical feature registry with the existing Nexus Messages `SYSTEMS` list. This is a **static heuristic**, not proof of inaccessibility. A route may exist in another menu, nav bundle, or owner tool.

## Priority review
- **Ad Maker** (`/ads.html`) and **Image Board** (`/board.html`) appear in the owner registry but are not in the Messages system list at time of inspection. Verify their current owner links before adding duplicates.
- **Forge**, **AI Team**, and **Phone** already have explicit Messages entries; preserve these as canonical entry points.
- **Local AI** is marked planned without an owner route. Do not expose a nonworking control.
- Keep `SPACE_BUNDLES` and the existing Messages shell; do not introduce a second dashboard.

## Follow-up implementation
After validating existing navigation behavior in the actual owner account, add missing creative system entry points using the existing Messages component's navigation conventions and owner-only visibility. Keep customer UI unaffected. Then consider old page retirement in separate PRs after the route audit report.

This audit makes no runtime modifications, route removals, or changes to agent/phone/customer APIs.
