# Nexus Ally unified Qwen chat — V3

## Owner experience
- One chat history and one composer for normal Qwen conversation and work requests, replacing the separate Chat and Guarded Task forms.
- Shortcut chips for **Build Website**, **Make Ad**, **Find Leads** and **Work on Files** only **prefill the composer**. They don't start work or silently grant permissions.
- Local Qwen replies conversationally or returns a bounded structured proposal when explicitly asked to perform a task. The page displays **Approve & start**, **Change plan**, **Cancel** in that same thread. No tool runs on mere model output.
- A proposal is held by the local console server only (not the browser), with an unguessable one-use ID and a 15-minute expiry. Starting work requires a separate same-origin POST with `approved:true`; the old direct `POST /api/tasks` route is rejected. A cancellation or successful approval consumes the proposal and cannot be replayed.
- Work results appear back in the same chat, with recent jobs and Stop available in a collapsible activity section.
- Current work capabilities are unchanged: pinned guarded Qwen runner, isolated workspace, fixed commands/ad macros, **eight tool steps maximum per job**. Chat cannot approve arbitrary PowerShell, posting, deployment, purchases or unpublished rendering. Any inner runner needs-approval response remains unexecuted.
- The current launcher's page remains local to `127.0.0.1:9942`. No always-on background service or unrestricted shell is added.

## Rollout
1. Merge only after the owner accepts the layout and work-approval flow. CI and mocked unit tests cannot prove how the local 9B model will phrase every proposal.
2. Follow the existing checksum-pinned `install-qwen-console.ps1` installer process for the **exact merged commit** to replace the local server and HTML panel together.
3. Reopen `http://127.0.0.1:9942/deck` on the Ally and live-test: normal conversation, workflow shortcut (prefill only), work proposal (not started), cancel, proposal approval, job progress, and Stop. Confirm the Qwen service at port 9931 is online.
4. If Qwen returns plain text instead of valid structured output, it stays a conversation and *does not start any job*. Retry/rephrase or roll back to the previous pinned local version; never auto-start failed proposal parsing.

## Previous console implementation


This adds a live chat, guarded task list, and tool-activity display directly to the existing customizable **Nexus Ally Launcher**. It is not a replacement for Explorer or Windows.

## Architecture

- A **manually launched** Node service binds only to `127.0.0.1:9942`; it serves the local launcher at `/deck` and the embedded console at `/`. The launcher and iframe therefore share the same trusted origin. The owner desktop shortcut starts the service on demand; there is no Windows startup task or permanent service.
- Chat still calls **only** local Qwen `127.0.0.1:9931/v1/chat/completions`, **without model tool calls**. Qwen returns a plain conversational answer or structured proposal; execution only happens from a separate approved server action. No cloud fallback. Conversation history is held only in the browser tab and can be cleared.
- Owner-approved chat proposals launch the **existing pinned local runner** `scripts/ally/qwen-terminal-agent.mjs` via fixed Node arguments (`shell` is not used). The model can use workspace-confined file operations and approved read-only checks, not arbitrary PowerShell. A second active task is refused. Other commands result in `needs_approval` **without executing them**.
- Live status scans the last ten local job receipts (last six events per job) and Qwen health. The API strips tool output and file content rather than displaying it in the dashboard.
- Only same-origin JSON POST requests with `X-Nexus-Panel: 1` are accepted. Exact localhost Host header is required. No CORS headers are sent. Server does not bind any LAN or WAN interface; it needs no API key or browser credentials.

## Install / recovery

1. Merge the PR and verify CI. Pin the final commit SHA and compute SHA-256 hashes for `scripts/ally/qwen-console.mjs`, `public/ally-qwen-console.html`, and `public/ally-launcher.html` from that exact commit.
2. Run a SHA-256-verified copy of `scripts/ally/install-qwen-console.ps1` through the **existing owner-only Ally terminal tool** with `-Revision`, `-ServerSha256`, `-PanelSha256`, `-LauncherSha256`, optionally `-Launch`. The installer rejects mismatches, checks Node syntax, and retains versioned copies under `%LOCALAPPDATA%\NexusAlly\launcher\versions\<commit>`.
3. The desktop **Nexus Ally Launcher** shortcut is updated to open a PowerShell script that starts the service on demand, then launches the local HTML deck in Edge app mode. Pairing, Windows shell, and startup settings stay unchanged.
4. Visit `http://127.0.0.1:9942/deck` to see the full deck, `http://127.0.0.1:9942/` for just the console. These addresses work **on the Ally only**.

For shutdown, close the launcher window and terminate the current-user `qwen-console.mjs` Node process; the installer does not configure auto-start. Earlier launcher versions and desktop shortcut configuration can be restored without re-pairing.

## Testing

`node --test test/ally-qwen-console.test.mjs`

Mock tests cover local-only chat, URL/origin/host restrictions, pinned runner invocation, duplicate task rejection, status redaction and owner stops. A mock pass is not live Qwen validation: after installation, confirm the UI renders in Edge, Qwen health, one chat reply, and one harmless guarded test task on the physical Ally.
