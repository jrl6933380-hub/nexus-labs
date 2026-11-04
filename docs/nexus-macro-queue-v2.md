# Nexus Macro Controller v2 — private ad brief queue

## User workflow (plain English)
1. Open **Macro Controller** from the private owner Home.
2. Fill in **What are you advertising?** and **What should the ad say?**.
3. Tick the explicit **private video render approval** for this single job, then tap **Make the ad and send it for review**.
4. With the ROG Ally awake and the owner-started Nexus Qwen Console open, the separate Macro Job Watcher claims the oldest approved job for **that exact paired device**.
5. Qwen generates only validated advertising **copy data** from the owner's brief. No model-produced PowerShell, HTML, filesystem paths, URLs or remote commands are executed.
6. The watcher runs only existing local allowlisted QwenBridge actions: **start_ad → update the created project's text config → preview_ad → render_ad**, followed by the preexisting **submit-ad-review.ps1**. A successful, verified MP4 goes to the private Nexus review inbox. Variants and packaging remain independently available macros; they are not silently run for every job.
7. **You review it on your phone** and approve or request changes. Existing auto-revisions and the unchanged Video to Board macro then handle the approved video. Public posting remains a separate approval gate.

This v2 does not wake a sleeping Ally; its polling worker runs only while the user-started Qwen Console is running.

## Safety, ownership and recovery
- New API: `/api/macro-jobs` with owner-session protected list/create/cancel, an Origin check, and paired-device authenticated claim/heartbeat/complete/fail. It reuses existing DPAPI device authorization, not a new key.
- One private-render grant **per created job** (`render_approved:true` from the owner's checked consent). No model can grant itself permission.
- Redis-backed owner-scoped jobs retain an explicit request ID for idempotent submits; active jobs have device-bound tokens and 30-minute heartbeat-renewed leases.
- An interrupted job becomes **Needs attention** after lease expiry. It never auto-reruns an uncertain render or upload; inspect local projects/exports and private review queue first.
- The private uploader returns a review ID; server completion independently checks this ID against the real owner-only ad review, project ID, paired device and review status.
- Canceling before claim is immediate. Canceling a running job requests a stop **after the current noninterruptible macro step**; it is not an emergency stop of ffmpeg or a partially completed upload.
- Local scripts are downloaded only from an exact reviewed merge SHA with size, SHA-256 and syntax verification in the existing versioned Launcher installer. No scheduled task, shell replacement, autoplay service, or new admin access.
- Existing desktop **Video to Board**, **QwenBridge**, AdStudio, reviewer, and revision flows remain independently available and unchanged. No public social posting capability is added.
- Current worker avoids active guarded Qwen Console tasks, and processes one job per running console. Uncoordinated manually started macros may still compete for device resources; operator can pause the queue by closing the console. A future shared global macro scheduler can serialize every legacy manual entry point without modifying the macros themselves.

## Activation and acceptance test
Merge after explicit owner authorization; verify Vercel production READY; compute exact SHA-256 for all new/updated Launcher files and install from the exact **merged commit** using new installer parameters **MacroWatcherSha256** and **MacroTransportSha256**. Preserve old version manifests and rollback files, restart the user-started console.

Test on a clearly labeled **TEST ONLY** ad: submit an owner brief → device claim → Qwen JSON copy → project creation → preview → render → private upload → owner review appears → approve → previously verified Video to Board handoff → board Saved. Inspect worker status and confirm no duplicate output. Do not publish social content as part of acceptance.

This PR is code plus simulated contract/E2E tests only. Do not label live Ally automation verified before the physical acceptance run.
