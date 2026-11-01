# Ally read-only screen transport (v0.2)

This change is staged behind a PR, **not installed** on the ROG Ally. The current running Ally PowerShell v0.1 continues heartbeat-only. Do not assume screenshots work until a new version is merged, deployed, and downloaded to the Ally.

After owner approval, merge and verify deployment. Then stop the Ally's existing PowerShell connection with Ctrl+C; download **fresh** `scripts/ally/connect.ps1` from the merged main branch, replacing the previous file; visually review the script; and run `powershell -NoProfile -ExecutionPolicy Bypass -File ./connect.ps1 -Action Connect` from Downloads. Existing DPAPI pairing credential is retained, so no need to re-pair.

Refresh the Nexus Workspace connector for **both** ChatGPT and Claude, and check `read_nexus_ally_status`. Use `request_nexus_ally_screen` (returns a command_id), then `read_nexus_ally_screen_result` with that ID. Screen requests expire; results expire after two minutes. No remote mouse, keyboard, shell, or model operations are in this PR.

The screenshot is a compressed JPEG of the **entire visible virtual desktop**. It can contain private data. Close sensitive apps/tabs before the test, and only launch the companion while comfortable sharing the visible desktop with the authenticated owner connector. Screen commands never run without a locally started visible session. Stop/Revocation blocks access.

Physical-device verification, locked-screen behavior, multi-monitor limits, screenshot size handling, race-condition tests, and security regression tests remain outstanding. Do not enable more powerful control until reviewed.
