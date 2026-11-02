# Nexus Ally local Qwen console — V2

This adds a live chat, guarded task list, and tool-activity display directly to the existing customizable **Nexus Ally Launcher**. It is not a replacement for Explorer or Windows.

## Architecture

- A **manually launched** Node service binds only to `127.0.0.1:9942`; it serves the local launcher at `/deck` and the embedded console at `/`. The launcher and iframe therefore share the same trusted origin. The owner desktop shortcut starts the service on demand; there is no Windows startup task or permanent service.
- Chat calls **only** local Qwen `127.0.0.1:9931/v1/chat/completions`, in plain response mode **without tool calls**. No cloud fallback. Conversation history is held only in the browser tab and can be cleared.
- Guarded task requests launch the **existing pinned local runner** `scripts/ally/qwen-terminal-agent.mjs` via fixed Node arguments (`shell` is not used). The model can use workspace-confined file operations and approved read-only checks, not arbitrary PowerShell. A second active task is refused. Other commands result in `needs_approval` **without executing them**.
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
