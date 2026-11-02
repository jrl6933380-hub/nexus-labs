# Nexus Ally control toolkit v0.3 — staged review build

Adds owner-only Nexus Workspace actions to existing connected Ally: status, screenshot (existing), Notepad launcher, mouse click, scroll, text typing, navigation keys, localhost Qwen health, and read-only drive free-space inventory.

## Security and limitations
- Interactive PowerShell companion, user-started/visible, no automatic boot or elevated permissions.
- No arbitrary shell, process execution from user-supplied text, file deletion, credential/password entry, browser navigation to arbitrary URLs, or model file edits.
- Click/type/scroll/key require a screenshot frame ID created within the previous 30 seconds. Coordinates normalized to the captured virtual desktop.
- Results are session-scoped and short-lived; after uncertain execution never resend without a fresh screenshot.
- Callers must have owner workspace access, and should obtain explicit approval before consequential clicks.
- Screenshot/image results may reveal personal content; close private tabs before testing.
- Only approved fixed application launched is Notepad. Qwen health checks only loopback 127.0.0.1:9931.
- Storage status is drive free/total **only**; no cleanup runs.
- Three transient connection failures are tolerated before the companion exits. Reconnect manually if it stops.

## Test plan after merge and deploy
1. Stop currently running Ally companion with Ctrl+C; download updated `scripts/ally/connect.ps1` from reviewed main revision (replace the file; don't re-pair).
2. Reconnect with `powershell -NoProfile -ExecutionPolicy Bypass -File ./connect.ps1 -Action Connect`.
3. Refresh Nexus Workspace connector in ChatGPT and Claude.
4. Run status → qwen_status → storage. All must be read-only and return receipts.
5. Request a fresh screenshot; inspect it, then `open_notepad` and new screenshot; type a harmless test sentence into Notepad using fresh frame. Verify on-screen and stop.
6. Test expired frame, malformed coordinates, invalid key, command duplication, disconnect/revoke, slow response, and locked screen refusal before production reliance.

**Not yet verified on the physical ROG Ally.** Do not merge this as a certified end-to-end control system without tests and owner approval.

Future work: explicitly permissioned app allowlist, screenshot JPEG quality tuning, model server start/stop with owner control, storage cleanup candidates with per-file approval, signed installer, and more resilient transport.

## v0.3.1 receipt and screenshot repair

- The existing `complete_screen` path now registers the captured frame and
  `read_nexus_ally_screen_result` returns its `frame_id`. Controls consume the
  frame; request another screenshot after each input action. Reconnecting clears
  pending work and frames from the previous session.
- The companion serializes nested receipts with JSON depth 8 so drive arrays and
  byte counts survive. Status reports `0.3.1`; connection messages describe the
  bounded controls accurately.
- The screenshot repair is server-side and works with the existing v0.3 companion.
  Storage reporting needs the updated companion downloaded and Connect restarted;
  the saved device pairing remains valid.
- Regression checks: `node --test test/ally-bridge.test.mjs test/phone-bridge.test.mjs`.
  On Windows, run `powershell -NoProfile -File ./scripts/ally/test-receipt-json.ps1`
  to check actual nested JSON serialization without pairing or network calls.
- Physical mouse/typing and Windows receipt verification remain required after
  deployment; automated bridge tests are not physical-device certification.

## v0.3.2 Windows display scaling repair

Physical Ally testing verified typing, but clicks aimed at Notepad menus landed
in the document instead. The companion mixed DPI-virtualized desktop bounds
with physical screenshot/cursor coordinates.

Capture and click now temporarily select per-monitor-v2 DPI awareness on the
current thread, restoring the previous context afterward. Click coordinates use
the physical virtual-desktop origin and size; screenshot capture uses that same
coordinate space before reducing the image to 1280 pixels wide. Cursor movement
failure now returns a failed receipt rather than claiming success.

Download the updated companion and restart Connect; no pairing is required.
Status should report 0.3.2. Verify menu clicks at the Ally's existing display
scale, then typing, before relying on it. No display settings are changed.
The Node bridge suite does not exercise Windows user32 or physical input;
this patch still requires on-device verification after installation.
