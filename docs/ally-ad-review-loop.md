# Local Qwen ad review loop

This routine extends the existing Ally + localhost Qwen setup. No cloud model,
API key, publication, or account changes are involved. It runs as the Windows
user in a visible process and is invoked through the paired terminal connector.

## Behavior

1. Draft a 15-second concept, or review a supplied seed project.
2. Run the exact shared `public/ad-vocabulary.mjs` validator.
3. Check exact total duration, concept labeling, a short opening hook, one closing
   CTA held at least three seconds, and a reading-time estimate.
4. Send specific errors to local Qwen. Accept a narrow duration/params patch or
   a full revised project. Revalidate every result. Model output is JSON data,
   never evaluated code or a terminal command.
5. Stop after **two repair attempts**. Persistent errors become `needs_help`,
   with the draft and feedback retained. Successful data checks become
   `awaiting_visual_review`, with `project.json` and a local `preview.html`.

Reading-time estimates use .6 seconds + word count / 3.5 + any step stagger.
They are heuristics, not a readability certificate. Text-only Qwen cannot judge
rendered frames. This version deliberately supports hook_text, before_after,
steps_list and end_card only. It does not automatically save to Nexus Ads,
render MP4, publish, post, install startup tasks, or declare visual approval.

## Owner tools

- `start_nexus_ally_ad_review`: starts a brief of up to 1000 characters. Returns
  `job_id` and `command_id`. Read the command receipt before assuming it started.
- `check_nexus_ally_ad_review`: inspect that job through the terminal transport.
- `stop_nexus_ally_ad_review`: request cancellation; check for `canceled` afterward.

The tools require terminal capability and the local routine installation below.
All three are owner-only and use mutation request IDs because inspection also
queues a command. Do not start a second job just to poll an existing one. The
worker does not serve a network listener and contacts only `127.0.0.1:9931`.

## Installation and paths

Use a portable Node 24 runtime under `%LOCALAPPDATA%/NexusAlly/runtime/node.exe`;
verify the executable against the matching official nodejs.org SHASUMS256.txt.
No PATH, admin, startup, or pairing changes are needed.

Copy these reviewed files from one pinned repository revision, verify their
SHA-256 hashes, and retain their directory layout in
`%LOCALAPPDATA%/NexusAlly/ad-review/versions/<revision>/`:

- `scripts/ally/ad-review-loop.mjs`
- `public/ad-vocabulary.mjs`
- `public/ad-designs/vocabulary-player.html`

Run `node.exe --check` on the routine. Only after every file matches its digest,
write `%LOCALAPPDATA%/NexusAlly/ad-review/installed.json` with
`{"revision":"<commit SHA>","root":"<absolute version directory>"}`.
Previous versions remain available; rollback changes this pointer after review.
No companion restart is required because the routine uses existing terminal tools.

Jobs live in `%LOCALAPPDATA%/NexusAlly/ad-review/jobs/<job_id>/`. They retain input,
per-attempt raw model responses and metrics, progress state, review errors, and
accepted projects. Treat these files as private owner data. Re-running a job folder
never overwrites its prior draft. Do not put credentials in ad briefs.

## CLI

```text
node scripts/ally/ad-review-loop.mjs run --input request.json --job-dir NEW_FOLDER
node scripts/ally/ad-review-loop.mjs status --job-dir FOLDER
node scripts/ally/ad-review-loop.mjs stop --job-dir FOLDER
```

Input: `{ "brief": "The owner-approved ad brief", "targetSec": 15 }`.
Optional `seedProject` lets QA evaluate a prior local Qwen draft without another
full generation. Optional `model` selects a model already on the same local server.
The CLI never changes the model endpoint to a cloud or external service.

Progress: `drafting → checking → revising → checking → awaiting_visual_review`.
Other outcomes: `needs_help`, `failed`, `canceled`. Stop files abort in-flight HTTP
requests and prevent later attempts. There is a 300-second per-request timeout
and a 16-minute job deadline. HTTP/model failures are reported rather than
silently retried or sent to another provider. Crashes can leave a lock file;
inspect the process and prior state before manually recovering or using a new job.

## Verification

`node --test test/ally-ad-review.test.mjs test/ally-ad-review-tools.test.mjs`

Tests cover actual shared validation, timing/density feedback, successful repairs,
malformed JSON, malicious keys and code-like text, cancellation, persistence,
owner boundaries, tool routing, and the two-repair limit. Physical local-Qwen tests
must be recorded separately; passing these tests does not prove generation speed
or visual quality.
