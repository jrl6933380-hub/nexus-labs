# Nexus Ally: storage inventory (first bridge component)

The ROG Ally currently runs Qwen3.5-9B through a local llama.cpp server. This is the **read-only** inventory script for the upcoming Windows bridge (issue #868). It is **not** a remotely callable tool yet.

## Run on the Ally

Download the script from this repository's main branch **after this PR is merged**, or run from a checked-out copy:

```powershell
powershell -NoProfile -File .\scripts\ally\storage-inventory.ps1 | Out-File -Encoding utf8 ally-storage.json
```

Read `ally-storage.json` locally. It contains personal folder names and file paths. **Don't publish it in GitHub issues, logs, or screenshots without reviewing/redacting.** No information is uploaded automatically.

## What it measures

- Capacity and available bytes for fixed disks.
- Sampled sizes and largest files in Downloads, Desktop, user temp, and Hugging Face cache.
- No recursive deletion, installs, or system changes.
- Skips junctions and reparse points to avoid chasing symlinks.
- File enumeration is capped per folder (default 10,000). The `truncated` flag means a sampled total **is not the true folder size**.
- Missing or unreadable paths are reported, not treated as empty full inventories.

## Next implementation steps

- Expose redacted/summarized data through an owner-authenticated Nexus Ally bridge, with an explicit user-launched session.
- Add Windows Storage Sense/Temporary Files guidance and a list of proposed cleanup candidates with separate owner approval.
- Preserve the working Hugging Face Qwen GGUF and runtime cache, games, saved games, drivers, documents, and unknown files until individually approved.
- Physically test this PowerShell script on Justin's Ally and validate error handling, performance, and no writes before merging into a control workflow.

Windows PowerShell 5.1+ expected. No Windows installation or remote control is added by this PR.
