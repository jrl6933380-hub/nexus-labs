# Owner-reviewed Ally leads → Forge

## User workflow

1. Run **Find Forge Leads** on the Ally. A finished local review includes **Open Forge review → select and approve leads**, plus `forge-review.json` for file selection if needed.
2. The link carries a bounded research package in the URL fragment. It contains public business research and phone suggestions, never credentials or raw account headers. The page consumes and removes the fragment; it does not send it to the server. File selection is an alternative. Pending review data stays in that browser's session storage until the import succeeds.
3. Sign in as the Nexus owner. The page requires both owner identity and the existing Forge manager role; it does not accept an Ally or agent bearer credential as human approval.
4. Select candidates, resolve uncertain business identities, verify the phone at its linked source, and choose the website status. Each candidate needs explicit identity, phone and website confirmations. A Maps-captured phone is only a suggestion until checked. No number, source, testimonial or contact fact is invented.
5. Click **Approve and add to Forge**. Server validation accepts 1–10 reviewed US business phones and evidence links. Candidates still marked `needs_checking` or `has_website` cannot be imported until the owner resolves their classification. Already-found local duplicates remain excluded from that batch's selection.
6. A saved receipt shows added leads and skipped existing/suppressed leads. New leads are assigned to the approving owner's existing Forge identity and appear in that caller queue. Reassign through the existing operator tools if another caller should work them.

Forge Ops includes **Review researched leads**. Existing completed local reviews can be refreshed with `forge-leads.mjs --refresh-reviews`, which adds the handoff and suggestions from already-saved matching Maps captures. It does not start research, infer contact facts, import leads or contact a business.

## Import behavior

`/api/forge-research` is owner-session and manager-gated. GET checks access; POST requires JSON and an exact same HTTPS origin. Cross-site/no-Origin requests, bearer approval, customer sessions and non-managers are rejected.

The shared contract validates each selected candidate and its confirmation flags. The server uses the existing lead constructor and saves the normal Forge record plus source URLs, phone-source URL, original research status/date, reviewer and approval timestamp. It does not invoke Places, enrich through an API, build a preview, send a message, make a call or publish anything.

Deduplication includes all current Forge leads, including suppression records. It compares normalized US phone numbers, normalized name + exact normalized location, and a deterministic owner/batch/candidate lead ID. It does not perform fuzzy company matching. The prepared additions and receipt commit in one store EVAL transaction only if the full lead snapshot is unchanged; concurrent changes cause a fresh duplicate check. Existing records, notes, assignments and suppression flags are never overwritten by import.

The UI derives a stable request ID from the reviewed payload. The server saves the payload digest with the receipt. Identical retries return that receipt, and reusing a request ID with different details fails. A lost response can be retried without duplicate creation. Edited resubmissions still encounter deterministic lead IDs and existing-lead duplicate checks.

## Interrupted research recovery

Research locks now record a PID, random ownership token and start date. Another live worker blocks a new run. For a dead/legacy lock, the worker checks Windows process state before archiving the stale lock and acquiring a new one. A recently created empty lock is protected while its owner is starting; unrecognized lock contents require inspection.

Recovery marks unfinished research batches `needs_attention`, preserving their evidence and completed checks, then starts a fresh search. It never replays a browser step or an import. Release removes only the current worker's own lock. A separate recovery guard serializes takeover checks; if a recovery itself crashes, inspect `recovery.lock` before manually removing it.

## Rollout

Merge/deploy the owner review page and API first. Verify production READY. Then use `scripts/ally/install-forge-leads.ps1` pinned to the reviewed immutable source SHA and independent hashes for `forge-leads.mjs`, `forge-recovery.mjs`, `forge-browser.ps1`, and `start-forge-leads.ps1`. `-StageOnly` checks all files without changing shortcuts or active metadata. Activation refuses a running research worker, backs up installation metadata and refreshes completed reviews when there is no active lock. No credential, service, startup or OS-shell changes.

Do not activate the new handoff before its hosted review page exists. Before declaring live import verified, exercise owner login → existing Ally review → selection/verification → saved receipt → actual caller queue. Use a real owner-approved candidate rather than polluting the live caller queue with fictional tests.

## Validation

Run `node --test test/forge-research-import.test.mjs test/ally-forge-recovery.test.mjs test/ally-forge-leads.test.mjs` and `npx playwright test e2e/forge-research-review.spec.mjs`. The targeted **Forge Reviewed Leads** workflow also parses the installer on Windows. Tests run the actual transaction script through the production Lua interpreter with an isolated in-memory command fixture. Browser tests exercise mobile/desktop verification, retry identity, receipts, access gating, untrusted text and accessibility with simulated API responses; they do not claim a live database import.
