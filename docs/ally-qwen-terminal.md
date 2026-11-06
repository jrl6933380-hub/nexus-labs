# Guarded local terminal tools for Qwen on the ROG Ally

This is **not raw PowerShell or unrestricted host access**. It is a local Qwen tool-use controller, using the existing owner-started Ally connection. The model asks for one JSON tool action at a time; the controller validates and executes each action. Never interpret generated code or shell text as commands.

## Scope

- Local model: existing `http://127.0.0.1:9931` llama-server (no cloud fallback).
- Workspace: `%LOCALAPPDATA%/NexusAlly/qwen-workspace`; new-file creation and exact-once edits; no browsing Documents, Downloads, home directory, credential files, or system paths. Reject dotfiles, traversal, absolute paths, and filesystem links. This is **not an OS sandbox**: do not store secrets in the workspace and do not run generated scripts as your normal Windows user without owner review.
- Tools: `pwd`, `list_files`, `read_file`, `write_file` (new file only), `edit_file` (exact-once replacement), and `run_command` with **only** `node_check`. `node_check` parses JavaScript syntax; it does not execute code. Read-only Git command access has been **removed**. A new bounded `web_search` tool uses the fixed Google browser adapter after work approval; `macro_catalog` and `macro_handoff` expose the verified Macro Controller registry without bypassing owner approval. No arbitrary shell, package installs, direct website HTTP requests, system changes, posting, or credentials.
- Unlisted shell or Git commands return a **blocked** result and are never run, not even after work approval. This is intentional: approval of a creative job does **not** grant Qwen raw Ally terminal control. Macro rendering and owner-only workflows still retain separate gates.
- Up to 18 bounded model/tool actions per job and 20-minute total deadline. The model may use `set_plan` (1–6 items), `update_step`, and `get_plan` to keep a visible persisted checklist. Unfinished steps mean `needs_help`, not `done`. Bounded outputs, durable receipts and cancellation with a stop file remain in place. Model-generated text is untrusted data. No startup task, auto-run, publication, or autonomous background operation.

## Owner tools

After deployment and reconnecting the Workspace plugin, use `start_nexus_ally_qwen_task`, `check_nexus_ally_qwen_task`, `stop_nexus_ally_qwen_task`, and `read_nexus_ally_result`. Owner-only, using paired Ally terminal transport. All starts/status/stop actions return a command receipt, not an immediate completed job. The Ally must be connected. The local runner must be installed before starting.

## Install on Ally (once it reconnects)

The portable Node binary already installed for the ad-review loop can be reused. Stage `scripts/ally/qwen-terminal-agent.mjs` at the exact pinned commit under `%LOCALAPPDATA%/NexusAlly/qwen-terminal/versions/<sha>/scripts/ally/`. Verify SHA-256 of the downloaded file against the reviewed Git blob content, run `node --check`, then atomically save `%LOCALAPPDATA%/NexusAlly/qwen-terminal/installed.json` with `{ "revision": "<sha>", "root": "<version directory>" }`. Download only from the pinned repository revision; never execute code from a model-supplied URL. No companion restart is necessary.

For troubleshooting use the local CLI:

```
node scripts/ally/qwen-terminal-agent.mjs run --input input.json --job-dir NEW_JOB_FOLDER
node scripts/ally/qwen-terminal-agent.mjs status --job-dir JOB_FOLDER
node scripts/ally/qwen-terminal-agent.mjs stop --job-dir JOB_FOLDER
```

JSON input: `{"task":"Create a new hello.js file and check its syntax"}`. The model can request a file write and syntax check; it cannot run the generated script without a separate owner approval. Files remain on the Ally. Current implementation does not sync edits to GitHub or Nexus Ads automatically.

## Verification

`node --test test/ally-qwen-terminal.test.mjs test/ally-qwen-terminal-tools.test.mjs` plus live test on Ally once connected. A passing mock test does not prove Qwen's model JSON accuracy or device connectivity.
