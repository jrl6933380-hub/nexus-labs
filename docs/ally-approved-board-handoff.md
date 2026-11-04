# Approved Qwen video → Nexus Board (without changing Video to Board)

The new, separate handoff is: **Qwen render → private review → Request changes (optional) → owner Approve → approved-board watcher → verified copy in Downloads → existing Video to Board macro → Nexus board.**

## What stays unchanged
- Documents/NexusMacros/VideoToBoard/Video-To-Board.ps1 and the Video to Board desktop shortcut are NEVER modified. Manual selection and uploads keep working.
- Source ad projects and rendered originals stay in Documents/NexusAds.
- Approving a review does not publish, post, schedule, or send videos to social media.
- The existing macro owns the upload and confirms completion through its named mutex, pending-upload.json, duplicate check and Saved status.

## Owner workflow
- New Approved reviews queue a private board handoff for the original uploading Ally. Older approvals are not backfilled silently; the owner may tap Send approved video to board to opt in.
- While the owner-started Ally Console runs, a separate watcher authenticates as the already paired device and claims one approved video at a time.
- It selects only an export with a complete render receipt and successful H.264/decoded/silent checks. The exact file must match the server-approved byte count and SHA-256.
- It copies the video without overwriting to Downloads/Nexus-Qwen-Approved-<reviewid>.mp4. The original stays untouched.
- The separate worker invokes the existing manual macro with the verified Downloads file and review title. It uses the macro's existing default Nexus board URL. The board must be signed in and the visible Windows desktop available.
- Only a valid macro saved receipt marks board_status=saved. An uncertain, interrupted or failed transfer becomes needs_help. Inspect the board before any reattempt.

## Concurrency and safeguards
- Atomic device-bound claims have a 20-minute lease. Expired claims never auto-retry (an upload could have succeeded just before failure).
- The manual macro's existing Local/NexusVideoToBoardMacro mutex prevents simultaneous uploads. The watcher also refuses when pending-upload.json already exists.
- Reusing a previously staged Downloads file requires the exact approved SHA-256 and size. Different bytes at that name stop the process.
- No admin, no new API key, no new scheduled service or daemon, and no arbitrary model-supplied shell commands.
- A macro result of already_present is NOT enough to claim success.

## Activation
The GitHub PR itself does not activate the handoff. With explicit owner approval, merge, verify Vercel READY, then install Launcher scripts from the exact merged commit with validated SHA-256, Node syntax and PowerShell parsing. Installer now needs BoardWatcherSha256 and BoardTransportSha256 as additional parameters. Preserve rollback manifests and the original desktop macro.

Acceptance test: owner-approved isolated video → paired Ally claim → hash-verified Downloads copy → unchanged Video to Board macro → verified Saved receipt → video visible on board and board_status=saved. Never test by posting to a public social platform.
