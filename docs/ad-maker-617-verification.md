# Ad Maker #617: production verification and vocabulary constraints

Audit date: 2026-10-16 (UTC). Author: ChatGPT. Status: **deployment confirmed; visual/device review and authenticated design-write check remain blocked**.

This is a verification report and review input for Claude's [vocabulary spec PR #618](https://github.com/jrl6933380-hub/nexus-labs/pull/618), not a competing vocabulary specification. No runtime change is included. Do not merge without Justin's explicit approval.

## Story and boundary

An authenticated operator opens a saved campaign in Nexus Board or Ad Maker, edits its creative code, saves through the existing account-scoped design tool, reopens the saved result, then previews/seeks/records the same film. Vocabulary helpers must preserve that path and existing ads.

The audit read current main and production. It did not edit public/ad-maker*.js, the frame contract, lib/adCampaigns.js, Claude's spec, or any saved production campaign.

## 1. Is #617 actually live?

**Yes.** Evidence from direct file reads and the deployed endpoint, independent of GitHub search indexing:

| Check | Result |
| --- | --- |
| PR #617 | Closed; its implementation is present on main and the matching production release is READY |
| Production deployment | dpl_rKNbi5F9rmedFgB5rNBoFFY713TA |
| Production Git SHA | c8f74ae010bfbd03e3c48b36dedb7d958bfbda5f |
| Deployment branch / target | main / production |
| Deployment commit message | Give each ad its own editable creative code and motion canvas (#617) |
| Direct main file | lib/workspaceBoard.js contains save_nexus_ad_design and apply_nexus_ad_design at the beginning of WORKSPACE_TOOLS |
| Live POST /api/workspace-mcp, tools/list | Returned 29 tools; both design tools present, no JSON-RPC error |
| Public /ad-maker.html | HTTP 200, 16,397 decoded characters |
| Public /ad-maker-design.js | HTTP 200, 3,911 decoded characters |
| Public /ad-designs/nexus-team-film.html | HTTP 200, 17,484 decoded characters |
| Authenticated read_nexus_ad | Returned design, design_name, and the new design_contract from the live account |

Source links: [registry](../lib/workspaceBoard.js), [MCP endpoint](../api/workspace-mcp.js), [creative runtime](../public/ad-maker-design.js), [contract](../lib/adDesigns.js).

GitHub code search returning no match is not evidence of a missing deployment. Direct main-file reads and live tools/list both contain the tool.

### Discovery refresh

This ChatGPT session still exposed the **old** read_nexus_ad description and neither design-write tool, even while an authenticated read returned the new contract. This is a concrete client-discovery mismatch.

Refresh/re-scan the existing Nexus connection in each agent client, then confirm that save_nexus_ad_design and apply_nexus_ad_design appear. If an old session retains its inventory, retry discovery in a fresh session. Reloading an already rendered board alone does not prove the model's tool inventory refreshed. No new MCP server, App ID, shared owner credential, or authentication bypass is needed.

The deployed names are:
- read_nexus_ad: returns current configuration, creative source when present, baseline, and design_contract.
- save_nexus_ad: configuration changes; preserves existing creative code.
- save_nexus_ad_design: creative HTML or null to restore the template; requires current baseline.
- apply_nexus_ad_design: explicitly replaces the creative with a requested starter; not for routine edits to an existing film.

## 2. Remaining production checks

| Boundary | Status | Evidence / limitation |
| --- | --- | --- |
| Static production assets | PASS | Public HTTP 200 checks above |
| Server tool discovery | PASS | Live tools/list includes both design writes |
| Authenticated account → stored read | PASS | Live Nexus read returned campaign nexus-team-launch-20261016, baseline 0a95de95-2570-4bd7-96ec-63bbb16a7a75, 19-second portrait configuration, design:null and design_contract |
| Authenticated design save → read-back | BLOCKED | This session's exposed tool inventory lacks the design-write tools. No save was attempted through credentials exported to a sandbox or an unauthenticated fallback |
| Browser rendering / console / screenshot review | BLOCKED | Browser installation succeeded on the second attempt, but Chromium launch failed before page navigation |
| Physical iPhone / Safari review | NOT RUN | No signed-in device/browser session is attached |
| MP4 export | NOT IMPLEMENTED / NOT TESTED | Separate planned phase; no video-export success is claimed |

### Browser attempt evidence

The ordinary local execution environment was unavailable. An isolated E2B sandbox successfully fetched production and discovered its tools. Its initial inventory contained no browser executable, Python Playwright, or system ffmpeg.

First browser setup attempt returned only a tool error (exit status 1 / INVALID_ARGUMENT), without usable browser results. A smaller second attempt captured explicit diagnostics:
- Python Playwright installation: return code 0.
- Chromium headless-shell installation: return code 0 (Chrome Headless Shell 156.0.8078.4, Playwright build v1248).
- Chromium launch: process exit code 127, with:
  `error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory`.

Therefore **no screenshots were captured, no pixel comparison ran, and no visual approval is recorded**. Installing a browser binary alone does not establish a working browser environment. Playwright also downloaded its bundled FFmpeg component; that is not verification of a general-purpose export encoder.

Use a dedicated E2B QA template containing the browser's OS dependencies (or install those dependencies in the QA sandbox), then run the attached [public-production smoke script](../scripts/qa/ad-maker-production-smoke.py). This is QA-environment work, not a requested change to Nexus runtime files. The script targets phone-sized Chromium and desktop Chromium; even a pass does not substitute for physical iOS Safari review.

The smoke script is syntax-parsed by the attempted Python run but its browser assertions remain unexecuted because launch failed. It is read-only: source is previewed in memory, not saved to production.

### Signed-in write test after discovery refresh

Use a fresh explicitly named QA campaign, not the working launch campaign:
1. Save a concept-only QA campaign through save_nexus_ad; retain its ID and baseline.
2. Read it with read_nexus_ad.
3. Save a small deterministic, visibly labeled concept design through save_nexus_ad_design with that baseline and a stable request_id.
4. Read it back; compare the complete creative source and confirm a new baseline.
5. Open it in both the authenticated studio and Board; reload and verify the saved design persists.
6. Save a copy/timing change; verify the creative remains byte-for-byte intact.
7. If testing stale writes, submit the old baseline and verify rejection plus unchanged current source. Retain the same request_id on an uncertain retry.
8. Record the actual results. Do not describe the above as completed yet.

No production campaign was created or changed during this audit. The working launch campaign's design was null at the observed read; the standalone starter preview is not evidence that it has been applied to that campaign.

## 3. Frame contract constraints for vocabulary helpers

### Preserve the callback and time semantics

The callback remains `window.renderAdFrame(frame)`, with:
`{timeMs, durationMs, sceneId, sceneProgress, sceneIndex, project, width, height, format}`.

- timeMs and durationMs are milliseconds. Scene duration values in project are seconds.
- sceneProgress is clamped to [0,1]. Seeking to a boundary selects the next scene, except the final endpoint remains the last scene at progress 1.
- Rendering must be a pure function of frame time/progress and configuration. No unseeded randomness, wall-clock time, accumulated movement, or uncontrolled CSS/JS animation.
- The current logical canvas sizes are portrait 360×640, square 560×560, landscape 800×450. Preview scaling/output pixel resolution are separate concerns. Test all formats and scene ordering.
- The bridge sends project only on configuration changes for efficiency, then caches and reattaches it before invoking renderAdFrame. Helpers should use the callback, not raw postMessage traffic.
- Helper functions should be deterministic and have bounded parameters. Transitions must define how adjacent scenes overlap, including short scenes, cuts, final frames and loop boundaries. Clamp transition spans to a valid fraction of scene duration.

### Delivery inside the existing isolation boundary

Creative code runs in an opaque iframe with `sandbox="allow-scripts"`, no same-origin capability or board tools. The CSP permits inline script/style, data: images/fonts, and no external resource loading. Do not use remote imports, CDN scripts, network fonts/images, eval/new Function, storage, cookies or credentials.

Recommended direction for the spec: **opt-in, version-pinned trusted helper injection**, installed before author scripts that might use its global API. Keep legacy/no-helper creatives unchanged. A global runtime that silently changes all previously saved films would undermine persistence and reproducible exports.

If the alternative is inlining helpers into each saved creative, their source counts toward the creative's 100,000-character limit. A versioned helper registry and renderer should share the same source of truth; describe_vocabulary, UI controls and validation must expose the same immutable IDs/version.

The current bridge is appended after author content. Simply appending a new helper there would be too late for author scripts that call it during initialization. This is a future implementation constraint, not a runtime change in this report.

### Legacy validation is a real compatibility boundary

Current browser normalization and server schema both require exactly one each of hook/team/reveal/close. Unknown project fields are either rejected server-side or omitted by browser normalization.

Current legacy bounds:
- Four scenes, unique fixed IDs.
- Scene duration 2–15 seconds; resulting range 8–60 seconds.
- Scene headline max 100 characters, support max 160.
- CTA max 35; campaign name max 80.
- Format is portrait, square or landscape.

Spec v2's 2–8 scenes, arbitrary IDs, params, tags, concepts and 1.5-second scenes need explicit versioned paths in **both** browser normalization and server validation, plus timeline/editor/export/import handling. Do not route v2 through the legacy normalizer or tighten legacy limits retroactively.

A character cap alone does not guarantee layout: long words, Unicode, wrapping, font metrics, safe margins and content collisions still need renderer bounds and browser tests. New constraints apply only to v2.

### Correct the size model in the spec

- **180,000 UTF-8 bytes** currently caps serialized project configuration, not the entire stored ad.
- Creative HTML separately caps **100,000 JavaScript string characters**.
- The creative name is 1–80 characters.
- Each stored logo/photo string is separately bounded to 140,000 characters; the aggregate configuration cap still applies.
- There is a 100-campaign account limit.
- Owner MCP JSON request parsing is limited to **256kb**. JSON escaping and multi-byte text can exceed that before a character limit is reached. Validate/measure transport byte size; do not assume the maxima are simultaneously usable in one request.

These are existing implementation facts, not a request to raise limits or move storage now.

### MP4 export requires more than a seek function

The current ready handshake checks the creative load/function and has a 10-second readiness timeout. It does not acknowledge completion of each rendered frame.

Before frame-by-frame export, specify a capture barrier: await creative readiness, fonts/images/assets, the exact requested render, and an acknowledgement tied to a frame request (or an equivalently reliable capture protocol). Freeze viewport, scale, device pixel ratio, frame rate and helper version. Repeating seek(t) must produce the same pixels regardless of prior seeks.

The present promise can already have resolved before a later render throws; export needs ongoing error checks, not just a one-time readiness check. Design revisions/baselines must remain pinned for the export job.

Do not add capture fields or messages to the frame contract during the spec reservation. Review additive export protocol changes in their own PR after approval.

### Concept and evidence labeling must survive custom code

Justin's stated scope is concept/pitch previews only. Stock vocabulary output should always visibly say **Concept preview — not a live site**, including website mockups and exported frames.

A boolean testimonial.verified is not evidence. Require a supplied source/approval reference for real attribution, and clearly label sample quotes/statistics. Do not let agents invent numbers or claims.

Custom creative code can remove labels rendered solely inside itself. If labeling must be unremovable, plan a trusted studio/export overlay outside the creative iframe, captured into the final output. #617 does not enforce this: its arbitrary creative source is the escape hatch, and the starter says “ILLUSTRATIVE TEAM WORKFLOW,” not the full requested concept-only label.

## Coordination / next step

Claude owns docs/ad-vocabulary-v1.md and PR #618. This report owns neither runtime implementation nor that spec. Suggested order after spec review: versioned registry/schema with compatibility tests → describe_vocabulary exposing that registry → stock player/UI and brief/edit/variant tools → export.

Unblock tool discovery and the browser QA environment before marking the production design-write and visual checks complete. No merge, deployment promotion, ad publication or ad spend is authorized by this report.
