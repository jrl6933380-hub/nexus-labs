# ROG Ally → Qwen ad review inbox (owner-only)

## Workflow

1. Qwen operates existing allowlisted ad macros. Final MP4 rendering stays approval-gated; a local render must finish and verify H.264 output first.
2. For an owner-requested finished ad, Qwen calls ad_macro with action=submit_ad and project_id set to the folder ID. The fixed submit-ad-review.ps1 reads only that project's folder under Documents/NexusAds and finds its latest completed full-quality ad-final.mp4. It refuses unverified, linked, oversized or missing video.
3. The uploader decrypts the paired Ally's existing DPAPI-protected token internally; the token is never displayed to Qwen. Upload destination is fixed to the official Nexus production origin and only an active paired Ally session can submit.
4. Video goes to a private, owner-scoped queue in 128 KiB parts, max 8 MiB, with SHA-256 and MP4 validation. A deterministic project+checksum ID permits safe replay from the same paired device. No public media URLs.
5. In Nexus owner Home open Qwen Ad Reviews (ally-ad-review.html) on iPhone. Owner sign-in is required and Safari can use byte-range playback.
6. Approve marks the review approved internally, and Request changes marks it rejected with an optional note. Neither button posts, publishes, emails, or starts follow-up agents. Later automation requires a separate explicit owner-approved process.

## Security and operating boundaries

- Uploads require the existing live Ally pairing token; no model-supplied URLs, command paths or source file paths are accepted.
- Review list, video and decisions require the authenticated Nexus owner. Browser decisions additionally require same-origin Origin.
- The storage limit is 8 MiB per video and each video and record expires after about 90 days. This is an initial small private queue, not an unlimited video archive.
- The source HTML and editable project stay on the Ally; only the verified MP4 and metadata are uploaded.
- The fixed uploader uses Windows DPAPI locally. Qwen never handles the token and cannot choose a network destination.
- Rendering and checksum success do not establish visual approval. Review the video before approving.
- Request changes stores feedback; it does not automatically restart Qwen.
- After review and merge, stage BOTH scripts/ally/qwen-terminal-agent.mjs and scripts/ally/submit-ad-review.ps1 from the exact pinned commit into the same NexusAlly/qwen-terminal/versions/<sha>/scripts/ally/ directory. Verify hashes and syntax before switching installed.json; keep a rollback manifest.
- This workflow requires merging and deploying the API/UI change, installing both local files and a live phone + Ally upload smoke test. Prior to those checks it is not live.

## Regression tests

Run: node --test test/ally-ad-review-queue.test.mjs test/ally-bridge.test.mjs tests/ally/qwen-ad-macro.test.mjs test/ally-qwen-terminal.test.mjs

Tests cover owner isolation, live pairing authorization, bounded/idempotent chunks, SHA checks, byte ranges, review decisions, unsafe requests, shell-free Qwen uploader and existing Qwen restrictions.
