# Video backend groundwork — cleanup handoff

This branch prepares a durable submit/poll/cancel execution contract inside the existing Nexus Lab job service. Production supplies no provider and stays **Needs connection**. No endpoint, model, credentials or paid resources are wired. No real footage was generated.

Justin subsequently clarified the target architecture to Claude: connected LLMs claim jobs and return validated work; Video composes the existing Ad Maker vocabulary and uses the existing code-video renderer rather than an outside generation model. The collaboration session explicitly requested that ChatGPT finish its current Understand/Video branches, then hand them to Claude for that conversion and scoring-harness work. This branch is groundwork for cleanup, not the final requested no-provider Video system. Do not enable it as an outside-provider product.

## Current contract

`createNexusLabVideo({assets,provider})` takes a server-owned verified adapter with stable `id`/`model`, `submit`, `poll`, optional `supports`, and optional `cancel`. Requests contain a 1–2,000 character prompt, 0–2 owner-scoped image references, integer duration 1–10 seconds and portrait/square/landscape aspect. Input references are bounded and checksummed through the shared media loader.

Submission intent is recorded before submission; the returned remote ID is persisted. Later workers resume that identity. An unknown submit outcome does not automatically resubmit. Waiting or transiently failed polls defer to a later worker, bounded by the existing ten-minute job deadline. Polling does not exhaust worker-loss attempts. Known provider failure is distinct from an uncertain outcome. Errors never expose raw adapter exceptions.

Successful output must be a buffer from a supported video type, 16 bytes to 20 MiB, with bounded dimension/duration metadata. It is uploaded to the shared media store with generated provenance, optional reference parents, checksum and a durable upload checkpoint. A restart reuses that asset. Playback/codec validity and factual dimensions are not proven by header sniffing; no decoder is introduced here. A crash between creating an upload and recording its checkpoint may leave an incomplete orphan, but never causes a second paid submission.

The saved run links its output asset. Handoff metadata points to `/ads.html` and the shared media ID, which is already available to the Ads media picker. This does **not** automatically create an editable campaign, insert a vocabulary layer, publish, or prove the final Ad Maker rendering flow. That direct composition/renderer integration belongs to Claude's requested cleanup.

API cancellation fences local execution first. If the adapter confirms remote cancellation, that state is saved as `provider_confirmed`; absent support or a failed cancellation remains `local_only`. Cancellation after a provider has accepted work may not stop billing. The shared fenced job finish protects job state; run-list writes and job writes are separate, as in the current harness. Runtime verification, input UI and video playback UI remain disabled/unimplemented in this branch.

## Validation

`node --test test/nexus-lab-video.test.mjs test/nexus-lab.test.mjs test/nexus-lab-jobs.test.mjs test/nexus-lab-assets.test.mjs` — 44 checks passed. Tests exercise real services with in-memory commands and a synthetic video-header fixture: submit-once, delayed polling, restart, upload recovery, asset export/provenance, uncertainty, known failures, cancellation, isolation and output bounds.

No real dispatcher/model/provider request, real decoded video, browser/device playback, live Neon/cron contention, paid call, production change or deployment was performed. Runtime readiness remains unchanged.

## Merge/cleanup coordination

Understand is PR #796 on `chatgpt/lab-understand`. This Video branch was independently created from main as the lead requested. `lib/nexusLabMedia.js` and `test-support/labMediaFixture.mjs` are identical shared additions. Reconcile shared service/jobs/runtime/worker hooks with Understand and Claude's embeddings/agent-tools changes; do not choose one branch's capability list over the other. Current adapter machinery is temporary pending Claude's no-provider conversion and test-set/scorer integration. No merge until Justin approves.
