# Qwen Ad Factory — automatic phone feedback revisions

## Owner workflow
1. Open the **Qwen Ad Reviews** tile in Nexus owner Home (same existing /ally-ad-review.html).
2. Watch a submitted MP4. Tap **Request changes**, write specific feedback, then **Send to Qwen**. A note is required.
3. The authenticated local console watcher on the paired Ally polls the existing private API while the launcher is running. It claims only jobs for its own paired device. The owner page shows Queued → Qwen working → New version ready, or Needs help.
4. Local Qwen proposes a tightly validated JSON patch to the ad's editable **headline, offer, CTA, brand and palette**. No model-supplied PowerShell, shell or HTML can run. Source stays untouched; the worker creates a separate versioned project under Documents/NexusAds.
5. An explicit phone **Request changes** is the authorization for the fixed local macro to render the revised project (the original general-purpose Qwen render tool remains approval gated). Verified MP4 is submitted with its parent review ID; the owner gets a *new*, pending-review entry. The rejected original and feedback remain accessible.
6. The owner decides on the new version. **Approve is internal only and NEVER publishes, posts or schedules content.** Publishing remains a separate future approval flow.

## Safeguards
- Existing device pairing and owner session are reused. No new API keys or public media URLs.
- The companion's DPAPI token is accessed only by PowerShell transport and uploader; never sent to Qwen or logged.
- Claim and completion require the original submitting device and a private claim token; atomic compare-and-swap prevents double claims.
- Active leases last 30 minutes and renew during local revision work. A failed job stops and shows **Needs help** with explicit retry. Hard cap: three claims per rejected review and five generations of revisions.
- Existing 8 MiB/90-day media bounds, owner-only byte-range playback and no-publish semantics are unchanged.
- The first automatic revision engine safely handles *structured copy and color changes* in editable Nexus AdStudio templates with embedded ad-config JSON. Structural animation/layout edits and custom unrecognized projects go to Needs help for human/agent attention rather than pretending they were applied.
- No unattended ad-brief production queue, remote-shell control, or publishing was introduced.

## Activation after PR merge
A merge alone is not activation. Pin **both** the Qwen runner/uploader and the Ally Launcher/Console to the same merged 40-character commit, SHA-256-verify downloads, parse PowerShell and Node syntax, and retain previous version manifests for rollback. The launcher installer now needs WatcherSha256 and RevisionTransportSha256 in addition to its original three file digests. The Qwen runner installation must carry the updated submit-ad-review.ps1. Restart the *user-started* local console so it loads the watcher. It does not install a new Windows scheduled task or permanent service.

Smoke test only after deployment and installation: submit a fresh ad, request a simple change (e.g. "Shorten the headline to under five words"), verify new local project, macro render receipt, private new MP4 and owner iPhone playback. Check duplicate claims, failure/retry, and confirm absolutely no publishing action.

Tests: `node --test test/ally-ad-review-queue.test.mjs test/ally-ad-revision.test.mjs tests/ally/qwen-ad-macro.test.mjs test/ally-qwen-console.test.mjs`.
