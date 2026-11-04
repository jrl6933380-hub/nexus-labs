# Nexus Macro Controller — v1 (owner Home)

## What is live in this release
One entry named **Macro Controller** appears on the **owner-only Nexus Home**. It opens `/nexus-macro-controller.html`, a phone-friendly library that explains existing macros in everyday language.

Every verified macro has:
- A friendly name and one-sentence explanation.
- **You need** (the required inputs) and **You get** (the actual output).
- **Show me the easy steps** for plain-English instructions.
- **Technical details (for agents)** for the exact verified macro action and script.
- An honest run mode: **You start it**, **Needs your approval**, **Runs after approval**, or **Manual shortcut**.
- Links to real existing Nexus screens. A link never silently executes a local PowerShell macro.

One central registry in `public/nexus-macro-registry.js` groups known actions under smaller controllers:
- **Make ads:** QwenBridge start, preview, variants, package, render. Owner-controlled rendering remains guarded.
- **Review & fix:** private Ally ad submissions and the already-tested automatic Request changes revision loop.
- **Save to boards:** previously tested approved MP4 → hash-verified Downloads copy → unchanged Video to Board macro, and manual Video to Board shortcut.
- **Research & leads / Device helpers:** explicitly labeled **Coming later**; do not list nonexistent macros as active.

## Safe access and live information
The dashboard is gated behind an authenticated GET to the **existing owner-only** `/api/ally-ad-review?action=list`. Unauthorized sessions never see the card UI. The page displays counts from the most recent private reviews returned by that API, not fabricated totals, and reads the existing paired Ally status from an authenticated `/api/ally` status request. When either source fails, the UI says it is unavailable; it does not show false success.

There are no new credentials or execution endpoints. No new app install, no privileged shell, no direct public access to review media, and no automatic social posting. The Controller is a single *library and status screen* for now, not an unattended remote-command channel.

## Preserve existing tools
Do **not** edit, replace, rename, or relocate `Documents/NexusMacros/VideoToBoard/Video-To-Board.ps1`, its Windows desktop shortcut, or the QwenBridge ad macros. The owner can keep using each manually. Model output is never passed to PowerShell directly. Review approval remains separate from social publishing.

## What still needs building for full unattended operation
This v1 does **not** create a persistent ad brief queue or cause an idle Ally to wake. Future controller work should add an **authenticated, owner-scoped, allowlisted durable job queue** with dedicated Ad/Research/Device subcontrollers, an explicit way for Qwen to receive an approved job spec, per-job idempotency, startup/resume behavior, operator visibility, and blocking approval gates for public posting and high-impact actions. Add only macros actually installed and verified on devices. Never advertise that the full autonomous factory is live before physical end-to-end tests prove it.

## Verification
- `node --test test/nexus-macro-controller.test.mjs`
- `npx playwright test e2e/nexus-macro-controller.spec.mjs`
- Targeted GitHub Action: **Nexus Macro Controller**
- Critical: owner Home tile is inside the `!ctx.customer` section; the page separately requires an owner session.
