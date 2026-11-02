# Ally watch mode (v0.5)

Watch mode is an owner-started, auto-expiring near-live view of the Ally screen for the connected Claude/ChatGPT agent.

**How it works.** `watch_nexus_ally` (5–120 s, default 60, or `stop: true`) marks the Ally session as watched. While watched, the visible companion window prints `WATCH MODE ON` and sends one compressed JPEG about every second (`complete_frame`). The server keeps only the newest 8 frames for 15 s under `nexus:ally:frame:<owner>:<slot>`. `read_nexus_ally_watch` (1–6 frames) returns them oldest first with their age, straight from the server, with no request to the Ally.

**Using it for control.** The newest frame's `frame_id` can drive click/type/scroll/key exactly like a screenshot frame, but only if nothing has changed the screen since it was taken (a frame older than the last action receipt + 400 ms is shown without a `frame_id`). Existing stale-frame rules (30 s, one use, session bound) are unchanged.

**Safety.** Frames are only accepted while watch mode is on, for the active paired session; they are bounded (JPEG, 450 KB), owner scoped, and expire. Stop, revoke, disconnect, a new session or the time limit all end it. The companion declares a `watch` capability; older companions cannot be put in watch mode (the server says to update).

**Install.** After merge and deploy: stop the Ally companion (Ctrl+C), download the new `scripts/ally/connect.ps1` (or use `update_nexus_ally_companion` with the reviewed commit and SHA-256), and run Connect again. Refresh the Nexus Workspace connector so the two new tools appear.
