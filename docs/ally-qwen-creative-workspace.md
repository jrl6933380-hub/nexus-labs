# Qwen Ally Creative Workspace — access contract

## Purpose
Keep Qwen useful for ads, standalone website drafts, bounded public research, owner-approved task plans, and approved local memories without allowing it to modify Nexus itself. This is a local Windows/ROG Ally creative environment, not a production Nexus control plane.

## Permission levels
- **Chat (no job required):** normal conversation, tool catalog explanation, and recall of explicitly saved local memories.
- **Memory changes (owner click):** save a proposed memory, delete a specific note, clear local conversation.
- **One approval per work job:** reading/writing exact files in the dedicated local Qwen workspace; editing by exact match; Node syntax checks (`node --check` only); public Google Search/AI Mode queries through the pinned, read-only Forge browser adapter; verified QwenBridge ad macros including start, preview, variations and package; private ad submission only for an existing finished project; job plans and checkpoints.
- **Separate owner-controlled flow:** final video rendering; review decisions and auto-revisions; approved-to-board handoff; manual Video to Board macro; any other high-impact Macro Controller action. Qwen can describe all nine verified macros and give an owner-only handoff link; it cannot silently execute those owner actions.
- **Disabled:** all GitHub and git operations, arbitrary shell/PowerShell, running generated JavaScript, browsing arbitrary URLs, Nexus source or app files, live website deployment, publishing to TikTok/social media, client outreach, customer or payment writes, Neon, Stripe, changing system settings, credential access, installations and deleting files outside the dedicated workspace.

## Macros in the verified controller
The local Qwen catalog imports the **same source registry** as the owner Macro Controller: `public/nexus-macro-registry.js`.
- Local guarded ad actions: Start ad, Preview ad, Variations, Package ad, Submit completed MP4 to private review. Qwen can invoke these only after job approval.
- Owner-controlled actions: Render video, Request changes, Approved video to board, and the manual Video to Board shortcut. They appear in Qwen's catalog with a handoff route, not uncontrolled shell execution.
- Unregistered personal macros are **not** automatically callable. New macros need a reviewed name, fixed argument schema, vetted script and explicit approval rule before adding them.

## Bounded research
`web_search` only creates a `https://www.google.com/search?q=...` URL (optional AI Mode flag) from a printable query capped at 140 characters. It calls a fixed, SHA-256-pinned `forge-browser.ps1` using typed `Open` and `Capture` operations; no model-supplied URLs or command lines are used. Capture returns limited snippets and public source links, redacts email addresses, and fails with a `needs_help` result if Google is still loading or requires manual verification. The browser is visible, and its Google UI capture is best effort rather than a general crawler.

## Website drafting
Qwen writes static HTML/CSS as new files under its isolated workspace, e.g. `sites/barber-demo/index.html`. The job receipt exposes eligible HTML paths for a **Preview site** button inside the same Qwen chat. The preview iframe uses the empty `sandbox` attribute, and the returned HTML is prefixed with an extra CSP disallowing scripts, connections, forms and external assets. This is a static preview: complex interactive apps/JS and live sites would require another separately reviewed execution environment and explicit owner action.

## Install and acceptance
The paired Ally must be online. Install only from the **exact reviewed merged commit**. The versioned installer `scripts/ally/install-qwen-console.ps1` now requires the original checksums plus:
- `-ToolSha256` for `scripts/ally/qwen-work-tools.mjs`
- `-ForgeBrowserSha256` for `scripts/ally/forge-browser.ps1`
- `-MacroRegistrySha256` for `public/nexus-macro-registry.js`

Installer stages and checksum-verifies all three alongside the existing server, memory module and task runner, then copies the browser adapter, tools and registry into the pinned guarded runner version. No Windows startup service, shell replacement, new device credentials, or arbitrary terminal permission is added.

After install, close the old local Qwen Console process and open **Nexus Ally Launcher**. Test in order: normal chat, memory recall, Tools drawer (nine verified macros), an approved harmless website file job, static preview, one public Google query and cited links, an approved ad macro catalog/preview, and one owner-only render handoff that does not execute. Verify the active runner and console manifests have the same commit SHA. No real customer outreach, public publishing, or production changes during acceptance.

Automated tests cover the contracts but **do not prove physical Ally/Google UI behavior** until a live device test has passed.
