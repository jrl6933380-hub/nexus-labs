# Nexus Lab

Owner entry: **Messages → Your Nexus → Nexus Lab**. Direct route: `/workspace.html?view=lab`.

The Lab is a view inside the authenticated owner shell, with an explicit Owner Home button. It is not a separate project iframe. Customer Home does not expose the tile, and `/api/nexus-lab` independently requires the Nexus owner session.

Design: preserve the existing forest/gold owner identity, compact capability index, task-specific work surface, readable result rows, and a shared history. Phone widths recompose into a single column. No unrelated home redesign.

## Available in this phase

- Search: installed tool/skill descriptions and Vault reference metadata; exact keyword matching by default. Full repository source is not indexed. With the existing `VOYAGE_API_KEY`, the owner can explicitly select semantic search; it sends the query and up to 60 keyword-shortlisted descriptions to Voyage, using `VOYAGE_EMBED_MODEL` or the existing `voyage-3.5-lite` default. A configured key is not proof of a healthy provider. Provider failures are visible and never silently converted to keyword results. This first version re-embeds the shortlist per run; a persistent source index and embedding cache are follow-up work.
- Rank: explicit query-token coverage over owner-entered candidates, stable input-order ties. It is labeled rules-based; no learned reranker or outcome prediction is implied.
- Predict: linear trend baseline for 6–200 equally spaced numeric observations; final 25% (rounded up) held out for MAE and last-training-value baseline comparison. The final model then fits all observations for the next estimate. This has no calibrated interval, causal interpretation, or ad-success guarantee.
- Shared history: newest 40 completed/failed runs per owner in the existing Neon-backed command store. Includes output, engine, duration, and an explicitly unavailable cost. JSON export works on each run. The last workspace and unfinished form inputs survive navigation within the same browser session.

The POST boundary requires same-origin JSON, bounds input sizes, validates capability inputs, and returns scrubbed upstream errors. No credentials are returned to the browser. The model provider is invoked only by an explicit semantic Run. No new paid resources are provisioned.

## Connection work remaining

| Workspace | Required implementation before it can run |
| --- | --- |
| Understand | Select and verify multimodal backend; media input validation; structured descriptions and timestamps. |
| Detect | Detector worker; normalized labeled boxes; image/video overlays and thresholds. |
| Cutout | Segmentation worker; original/mask asset storage; edge correction and export editor. |
| Video | Select provider; durable queue, progress/polling/cancellation, result storage, and Ads Studio handoff. Existing deterministic composition is available through the Ads Studio link. |

Those four workspaces show **Needs connection** and cannot manufacture a model result. Shared media uploads are now supported in Lab. An existing image generation pod is not treated as a segmentation/video backend.

Next shared-harness steps: durable queued/running states and cancellation; idempotent external jobs; persistent repository/asset indexes; learned reranker; MCP tools exposing the same service after owner/tenant and request-id guards. This phase exposes an owner API, not a new MCP tool catalog.

## Validation

`node --test test/nexus-lab.test.mjs test/owner-capabilities.test.mjs test/nexus-navigation.test.mjs`

`npx playwright test e2e/nexus-lab.spec.mjs`

The browser tests use the real Lab handler/service with injected owner authentication and an in-memory command store; fixtures stand in for catalog/provider data. They check Home discovery, Search/Rank/Predict, missing-backend states, saved history, return navigation, remembered workspace, customer exclusion, and overflow at 320/393/1000px. They do not establish production credentials, live Neon persistence, or live provider health.

The lockfile refresh adds the already-declared `pg` dependency and its missing transitive entries so clean installs can proceed.

Agent verification: 19 focused Node checks passed (Lab, owner capabilities, navigation, and navigation scope); a clean `npm ci --ignore-scripts` and the same 19 checks passed after syncing the latest main branch. Browser execution was blocked before a page could be created: default Chromium crashed; a single-process launch timed out during the Playwright page fixture. No rendered/mobile verification or live database/provider test is claimed. The focused GitHub workflow runs the browser checks on Ubuntu.


## Shared media assets

Open **Owner Home → Nexus Lab → Assets**, or use **Manage run assets** on a saved run. Every capability keeps access to the same library, including the media workspaces whose models are not connected yet.

`lib/nexusLabAssets.js` wraps `adMediaStore`; original bytes remain in the existing account-scoped chunk store and are immediately reusable by existing Ads Studio tools. No second binary store or copy is introduced. Existing library files are listed with unrecorded provenance until the owner records it. Lab metadata records role (original/mask/cutout/clip/output), source type, optional HTTPS source URL, attribution, rights notes, parent IDs, and recording time. These are owner-supplied statements, not verified licenses or evidence of model generation. Recorded provenance is immutable; derived files get new IDs and ready parent links. Parent ownership/readiness and ancestry are checked.

The UI uploads PNG/JPEG/WebP, supported audio and video formats in existing 384 KiB chunks, verifies SHA-256, and preserves available image dimensions and browser-reported media duration/dimensions. Existing store limits remain 60 files, 64 MiB per file, and 256 MiB per account. Image previews are small derivatives; previews do not replace originals. Downloads reassemble bounded chunks and verify both file size and checksum before saving. Original playback is available for files up to 20 MiB; larger files remain downloadable.

Pause/resume retains the same upload in the open view. After navigation or reload, choose an unfinished upload and reselect the exact original file to resume: size and checksum must match, and chunks can safely be resent. An unfinished upload can be explicitly discarded; finished originals cannot be removed through that action. A failed transfer remains visible rather than reporting a false save.

The owner API adds `asset_list`, `asset_read`, `asset_begin` (stable request ID through the existing workspace idempotency guard), `asset_chunk`, `asset_finish`, `asset_download`, `asset_adopt`, `asset_discard`, and `asset_attach`. All POST actions retain owner authentication and same-origin JSON checks. Chunk request bodies have a separate 540,000-byte bound; ordinary requests retain 130,000 bytes. No client-supplied account ID selects storage.

Saved runs can receive input/output **references**. Run existence and owner scope are verified before attachments; all media must be ready. The run history and JSON export include metadata/provenance snapshots. Links append by run/direction/media ID in a single hash write, so concurrent additions do not replace one another. Attaching a reference does not claim a model consumed or generated its bytes. Future media workers should use these contracts with the durable jobs task.
