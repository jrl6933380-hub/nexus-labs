# Find Forge Leads — owner-started Ally research macro

## What it does

Run `start-forge-leads.ps1` (or the **Find Forge Leads** Windows shortcut). Enter a business type and city; target count defaults to ten and is bounded to 1–10. The visible finite worker opens Google AI Mode, waits for its completed answer, reads only the matching Google browser document through Windows UI Automation, and asks the existing local Qwen endpoint to extract candidate names. Names must occur in the captured answer.

For each new candidate it opens ordinary Google Search and Maps, captures available evidence, and asks local Qwen to classify the result. Maps place redirects require a matching business name in the URL and requested city in the document. Unmatched redirects remain **Needs checking** for every classification, including a model suggestion that a website exists. Site ownership and business identity still require human review. This is a research shortlist, not a guarantee that a business has no website.

The fixed worker drives the browser; Qwen returns bounded JSON data only. No model-generated command, URL, script or HTML is executed. No Places API, new cloud model, credentials, scheduled service or paid resources are required. Browser access may still require the owner's Google sign-in. Captchas/verification are not bypassed.

## Output and review

Each batch saves privately under `%LOCALAPPDATA%\NexusAlly\forge-leads\batches\batch-<uuid>\`:

- `review.html`: local, script-free review table with Maps search links and captured source links.
- `shortlist.csv`: names, location, website status, notes, review links, duplicate flag and check date.
- `batch.json`: input, stage, candidates, classification, uncertainty, source URLs and timestamps.
- `forge-review.json`: bounded data package for the signed-in owner review page, with unverified phone suggestions when a matching Maps capture contains one.
- `discovery.json`, `search-N.json`, and successful `maps-N.json`: bounded captured page text and accessible source links. Account header/email text is redacted.

States: **No dedicated website found**, **Social / booking only**, **Has a website** (exclude), **Needs checking**. Every row requires human review. Missing captured source URLs, incomplete Maps verification, invalid model responses or conflicting identity never qualify as proven absence.

Duplicate matching uses normalized business name + requested area against candidates with a completed check timestamp in earlier local batches. Duplicates remain visible with a flag and skip fresh verification; candidates interrupted before classification may be checked again. This does not deduplicate against remote Forge leads. Older completed but uncertain results require manual review rather than an automatic re-check.

The research macro itself never imports into the caller queue. **Open Forge review** carries the completed package to the owner review page, where selected businesses require verified identity, phone/source and website status before import. See `docs/forge-reviewed-import.md`. No phone/email is guessed, previews built, messages sent, or content published.

## Recovery and limits

- The macro is user-started, visible, and finite; keep its browser windows open. No auto-start or wake behavior.
- Ctrl+C requests cancellation. The last completed stage and evidence stay on disk. Interrupted stages are never automatically replayed.
- A per-output-root `active.lock` records the worker PID and ownership token. Live workers block another run; a dead/legacy lock is archived only after process inspection. Unfinished batches are preserved as Needs attention before a fresh search starts. Unknown locks require inspection; no uncertain step is replayed. Release removes only the current worker's own lock.
- Sign-in/verification walls stop with **Needs attention**. Resolve them in Google, then start another batch. The browser reader waits at most 90 seconds for AI/Search and 18 seconds for Maps. Local model requests have a 150-second deadline.
- Browser UI, readiness text, accessible link support and Google layout can change. The exact query and AI-vs-regular-search mode must match before reading. A wall without an accessible matching page times out rather than reading another window.
- Up to 21 search windows for ten new candidates; the macro never closes the owner's windows. Google may return fewer candidates than requested. Large runs take several minutes on the Ally.
- This release is local only. It does not register as an active hosted Macro Controller research executor or expand Qwen terminal-agent tools.

## Install / verify

Keep the four scripts together in a versioned local directory: `forge-leads.mjs`, `forge-recovery.mjs`, `forge-browser.ps1`, `start-forge-leads.ps1`. Use the existing `%LOCALAPPDATA%\NexusAlly\runtime\node.exe`. The pinned `install-forge-leads.ps1` supports staging without activation and verifies all four source hashes before installing a shortcut. Deploy the review page/API before activation. The launcher uses a normal PowerShell process with no admin privileges.

Read-only install check: `start-forge-leads.ps1 -Check` prints hashes and checks the local runtime without opening Google or invoking Qwen.

Repository validation: `node --test test/ally-forge-leads.test.mjs` and `node --check scripts/ally/forge-leads.mjs`. Windows validation must additionally parse both PowerShell scripts and exercise browser capture + local Qwen on the real paired Ally. Simulated tests alone do not establish live end-to-end verification.

## Physical Ally acceptance (2026-11-05)

- Seven focused Node tests pass, including complete mocked runs, source constraints, duplicate checks and interruption checkpoints; syntax/diff checks pass.
- All three installed scripts matched independently calculated SHA-256; both PowerShell files passed the Windows parser and the Node worker passed its real Ally syntax check.
- Live Search and Maps browser captures succeeded. The first complete trials exposed OEM encoding corrupting browser JSON and a verification prompt exceeding local Qwen's 4,096-token context. The adapter now emits UTF-8 and model evidence is bounded separately from the full saved captures.
- A real one-candidate `barbers / Des Moines, Iowa` batch completed at `2026-11-05T09:23:36Z`: Google AI Mode → local Qwen extraction → ordinary Search + matching Maps place → local Qwen classification → **ready_for_review**. It returned **North End Barbershop**, **social_booking_only**, with observed Booksy and Facebook source links and a completed Maps check. HTML, CSV, JSON and raw evidence files were saved on the Ally. This is still a research suggestion requiring owner review, not proof of website absence.
- The installed worker revision is `142b3a4f4638d3189cabf8b76504d9ecdbc2950d`. No ten-candidate physical trial or remote Forge import has been verified. Nothing was sent, published or added to the calling queue.
