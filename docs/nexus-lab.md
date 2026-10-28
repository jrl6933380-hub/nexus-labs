# Nexus Lab

Owner entry: **Messages → Your Nexus → Nexus Lab**. Direct route: `/workspace.html?view=lab`.

The Lab is a view inside the authenticated owner shell, with an explicit Owner Home button. It is not a separate project iframe. Customer Home does not expose the tile, and `/api/nexus-lab` independently requires the Nexus owner session.

Design: preserve the existing forest/gold owner identity, compact capability index, task-specific work surface, readable result rows, and a shared history. Phone widths recompose into a single column. No unrelated home redesign.

## Available in this phase

- Search: installed tool/skill descriptions and Vault reference metadata; exact keyword matching by default. Full repository source is not indexed. With the existing `VOYAGE_API_KEY`, the owner can explicitly select semantic search; it sends the query and up to 60 keyword-shortlisted descriptions to Voyage, using `VOYAGE_EMBED_MODEL` or the existing `voyage-3.5-lite` default. A configured key is not proof of a healthy provider. Provider failures are visible and never silently converted to keyword results. Semantic mode re-embeds the shortlist per run.

### Embedding index (Indexed search)
The owner can build a persistent per-owner index (`lib/nexusLabEmbeddings.js`): one hash `nexus:lab:<owner>:embeddings:v1`, field = catalog item id, value = text fingerprint + model + vector (rounded to 4 decimals). **Build / refresh index** (API `index_build`) embeds only missing or changed items (model change also re-embeds), at most 192 per call (press again to continue), and drops removed items. `index_status` reports indexed/stale/missing/removed counts. **Indexed** search mode (also usable as a background job) embeds only the query and ranks stored vectors; stale entries are ignored and the run note says how many items are not yet indexed. Up to 300 catalog items are indexed; repository source is still not indexed. Building sends item names/descriptions to Voyage; a missing `VOYAGE_API_KEY` returns 409. Tests use fake embeddings, so live Voyage health and Neon storage size at scale are not verified.
- Rank: query-token coverage over owner-entered candidates, stable input-order ties. It understands simple synonyms and word endings without any model call (`lib/nexusLabSynonyms.js`): an exact word scores 1, a same-stem word or a word from the same built-in synonym group scores 0.8 (for example calm/peaceful/serene, senior/elderly, home/residence), and filler words such as "for" and "the" do not count. Each result lists which brief words matched through a synonym. On top of the groups it reads an offline copy of the WordNet dictionary (`lib/data/nexusLabThesaurus.txt`, about 64,000 words, built by `scripts/build-lab-thesaurus.mjs`, license in `lib/data/WORDNET-LICENSE.txt`): a close dictionary match scores 0.7 and a looser related word (a broader word, a similar adjective, a less common meaning) scores 0.4. Nothing leaves the server and there is no cost. The dictionary gives no context, so a word with several meanings can match the wrong sense at the weak 0.4 level. It is labeled rules-based (engine `token-coverage-dictionary-v1`); no learned reranker or outcome prediction is implied. Search keeps exact keyword matching (`token-coverage-v1`).
- Cutout refinement (`lib/nexusLabSegment.js`, run in the browser by `public/nexus-lab-cutout.js`; the browser loads a byte-identical copy at `public/nexus-lab-segment.js`, checked by a test). On a finished Cutout task each outline has a **Refine with the real pixels** button. It downloads the original from your library, refines the outline on-device, previews the cutout on a checkerboard with a plain-words confidence note, and only saves when you press **Save transparent cutout** or **Save mask**; saved PNGs are stored as derived `cutout`/`mask` assets with the original as their parent. The refiner: takes the rough polygon a connected AI returns and the picture's actual pixels, and produces a pixel-accurate soft mask with no model or service. It marks a band around the outline as unknown, learns subject and background colors from the surer areas on each side, then settles the band by color fit plus agreement with neighbors across weak edges. Runs on plain RGBA bytes, so it works in the browser (canvas) or on the server. It reports a separability score and a high/medium/low confidence, and it says low when subject and background are similar. Known limit: pieces of the background that match the subject's colors (for example a bright reflection under a lit building) can be pulled in.
- Predict: for 6–200 equally spaced numeric observations. It tries a straight-line trend, repeating the last value, the average of the last three, and (when a repeating pattern of 2–12 steps shows up in at least two full cycles) trend plus pattern. The final 25% (rounded down for the split, so the held-out part is rounded up) is held back to score them; the straight-line trend is kept unless another method beats it by 15% or more. It then refits on all observations for the next estimate and returns a rough likely range (about plus or minus 2 typical misses, not a calibrated interval), a low/medium/high confidence label and plain-word warnings (outlier spikes, flat data, no better than repeating the last value, very noisy, under 12 observations). It cannot establish causation or ad success.
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

Next shared-harness steps: verified media-provider adapters with remote polling/cancellation; persistent repository/asset indexes; learned reranker; MCP tools exposing the same service after owner/tenant and request-id guards. This phase exposes an owner API, not a new MCP tool catalog.

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

Shared-assets verification: 39 focused Node checks passed, including byte-for-byte multi-chunk exports, checksum failures, account isolation, immutable provenance, serialized concurrent adoption/ancestry checks, retained run links, and unfinished-upload cleanup. The first PR #787 GitHub Lab check also passed the upload/derivative/download/reopen/attachment browser flows at 320/393/1000px. Final revision browser checks are tracked on the PR; production persistence still requires verification after merge.


## Durable background jobs

Open **Owner Home → Nexus Lab → Jobs**. The existing Search/Rank/Predict forms also offer **Run in background**. **Run background check** creates a clearly labeled 15-checkpoint diagnostic; it does not invoke an AI model. The Jobs/Assets surface and unfinished form inputs are restored within the browser session.

The Lab queue uses the existing Neon command transport, the shared lifecycle vocabulary in `lib/jobStates.js`, and the render worker's claim/progress/result pattern. It adds per-record atomic compare-and-set updates and worker lease tokens. Job states are queued, running, succeeded, failed, and canceled. Leases last 15 seconds, heartbeats run every 3 seconds, safe work can resume at most three attempts, and jobs have a 10-minute deadline. Enqueue/retry share an account lock and a three-active-job cap. At most 60 full records are retained; older terminal records compact while retaining request identity and result references, so replaying an old request does not submit it again.

Enqueue returns HTTP 202 after saving the job. The owner route registers a worker promise with `waitUntil`; client disconnects do not drive execution. A scheduled `/api/nexus-lab-sweep` uses the existing `CRON_SECRET` every two minutes and processes at most two jobs per invocation as the recovery path. Both functions have a 300-second execution budget. Work is checkpointed in the database; `waitUntil` alone is not the durability mechanism. An operator may also invoke `node scripts/lab-worker.mjs` with the existing database credentials. No new model/GPU resources are provisioned by these changes.

The public owner API adds `job_enqueue`, `job_list`, `job_read`, `job_cancel`, and `job_retry`, retaining authentication, same-origin JSON, and payload bounds. A stable request ID binds to normalized input and owner; a conflicting payload is rejected. The browser retains an unacknowledged background request ID so a transport retry reuses it. Fenced leases reject late progress/results from a canceled or superseded worker. Completed capability jobs link to the same saved Lab run, preserving media attachments and normal run exports.

Before a provider request, workers persist a submission intent. Provider/model, a stable idempotency key, and an optional returned remote job ID are stored separately from credentials. If a worker disappears after intent and no remote ID is known, the job fails with `SUBMISSION_UNCERTAIN`; neither automatic recovery nor the Retry control resubmits it. A remote ID can be retained for a future provider resume adapter; current adapters will not pretend to poll an unsupported provider. This is conservative duplicate-submission protection, not a claim of universal exactly-once billing. Check the provider/saved result to reconcile an uncertain outcome.

The included worker supports the diagnostic and existing Search/Rank/Predict capabilities. Semantic search records its Voyage submission before calling the embedding-backed service; a configured credential is required before recording intent. No other media model is enabled. Canceling a job fences Nexus updates and aborts the local request when observed; if a provider request was already submitted, the UI explicitly says external cancellation is unconfirmed. No refund or remote cancellation is implied.

Progress and up to 30 checkpoint/status events are visible in Jobs. Provider/model versions and cost are recorded only when known; cost remains unavailable otherwise. Raw upstream errors, lease tokens, credentials, and internal job input are not returned in public job views. Recovery runs independently of the Jobs page, which only polls for display.

Verification commands now include `test/nexus-lab-jobs.test.mjs`, `test/ad-render-jobs.test.mjs`, and `e2e/nexus-lab-jobs.spec.mjs`. The browser scenarios use the real job API/service/worker with an isolated command transport and controlled diagnostic sleeps: reload while running, cancel, reject late completion, retry from a checkpoint, and open a background capability result at 320/393/1000px. Production cron timing, real database contention, and provider reconciliation remain live-deployment checks after merge.

The focused Lab browser workflow uses the Ubuntu runner's preinstalled Google Chrome through the existing NEXUS_TEST_BROWSER_PATH setting, avoiding a second browser/apt download. The workflow fails visibly if the expected browser is unavailable.
