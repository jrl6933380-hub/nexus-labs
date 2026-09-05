# NEXUS LABS — CLAUDE ↔ CODEX ↔ NEX BRIDGE

This is the shared continuity file for Claude, Codex (ChatGPT), and Nex.

## RULES

1. Read this entire file before changing it.
2. Rewrite the whole file after reading; never write blind.
3. Keep these sections in this exact order: STATUS, NEXT, BLOCKERS, DECISIONS, LOG.
4. STATUS and NEXT describe the present and must be rewritten each handoff.
5. DECISIONS is append-only except when correcting an explicit factual error.
6. LOG is newest first. Stamp entries as:
   `[YYYY-MM-DD] [CLAUDE|CODEX|NEX] — what changed; what remains.`
7. Update once at the end of a meaningful work session or before usage runs out.
8. Use commit message: `bridge: <agent> <YYYY-MM-DD>`.
9. Keep this file under roughly 150 lines. Condense old LOG entries into DECISIONS.
10. Do not store secrets, tokens, passwords, or private keys here.
11. **Verification, not just trust (Claude and Codex only):** before starting substantial new work, cross-check STATUS against real Vercel deployment history (and for merges specifically, whether the file you're about to build on actually has what STATUS claims — don't trust a PR's own description). If STATUS disagrees with reality, fix it and say so in your LOG entry.
12. **A PR sitting open is not the same as shipped.** Before marking anything STATUS as "done," confirm the actual file exists on `main` — not just that a PR exists for it.
13. **Env vars are not applied retroactively.** Connecting an integration or adding an env var does NOT update deployments that were already built. A fix isn't live until a NEW deployment exists that was created after the var. Also: the age column in Vercel's deployment list is build DURATION ("Ready 19s"), not how long ago it deployed — read `created` via the API, not the badge.
14. **When a message or task references a Vercel action, include the direct dashboard deep link, not verbal navigation steps.** "Go to Settings → Environment Variables" wastes taps and invites the wrong-page mistakes from the 2026-09-02 sandbox session. Vercel dashboard URLs are predictable and need no special API:
    - Env vars: `https://vercel.com/<team-slug>/<project>/settings/environment-variables`
    - Deployments list: `https://vercel.com/<team-slug>/<project>/deployments`
    - A specific deployment: its `inspectorUrl` from the Vercel API/tool output
    - Project overview: `https://vercel.com/<team-slug>/<project>`
    For this account, `<team-slug>` is `jrl6933380-hubs-projects`. Applies whenever a human needs to go look at or click something in Vercel — drop the link, don't describe the path.

## STATUS

- `nexus-labs` PR #54 is merged to `main` and production deployment `dpl_8pDqQ62k5zEN1VDu4T9WwPZEx7dZ` is READY. Room builds now use per-account, provider-neutral credit reservations (250 credits/30 days by default; fresh builds 10, edits 2), with safe expiry/release and session-scoped usage.
- **Account creation race fix is ready on `fix/room-account-creation-race`, pending PR review.** Room signup now uses Redis `HSETNX` to prevent concurrent signup requests from replacing an existing account password. Regression test proves exactly one simultaneous signup succeeds.

- `Nex disengage` direct-Claude handoff is implemented on a review branch: exact command creates a constrained Board task, wakes Claude Routine, tells Claude to read Board + BRIDGE.md + agent-lessons/, and returns the session URL. `Nex engage`/`Nex re-engage` explicitly hands lead control back. Tests cover strict command matching, successful wake, and fail-closed behavior.
- Production (`nexus-labs`, `main`) confirmed live and current: Stark/JARVIS UI, dynamic agent registry wired into `/api/board`, Nex's Agent Board tools, Nex's branch-scoped build mode, `agent-lessons/`, SMS approvals (still needs Twilio env vars + webhook config), searchable/tagged memory, a longer Nex chat window (24 messages), and `listRepos()` for Nex (PR #7, merged and live-verified).
- **Sandbox board is FIXED and live.** `nexus-labs-sandbox.vercel.app/api/board` returns HTTP 200 with real data (verified via the Vercel API, not a claim). It had been 500ing on `Missing KV_REST_API_URL or KV_REST_API_TOKEN`. Root cause was NOT the env vars — they were correct and correctly scoped the whole time; the live production build simply predated them. Fixed by commit `aa188e1` to sandbox `main`, which forced a real production build. See rule 13.
- **Sandbox and production share ONE Redis** — see BLOCKERS. Not a deliberate choice.
- **Epic task 01 (task envelope) and task 02 (approval-aware dispatcher) are both merged to `nexus-labs-sandbox` `main` and complete.** `lib/taskEnvelope.js`, `lib/dispatcher.js`, `lib/boardDispatcher.js` all live on sandbox `main`; verified by re-reading files directly (not trusting PR descriptions) and re-running the full test suite fresh in a sandbox (28/28 passing).
- `github-write-mcp` (the real connector) shipped a gated `merge_pull_request` tool plus `list_repos`/`list_pull_requests`, all merged and live.
- E2B/`run_sandbox` — verified fixed AND live-tested.
- Sandbox PR #6 (`fix/upstash-board-env-fallback`) is confirmed unnecessary — the env names were never wrong. Close it.
- Mission-orbit still shows only Nex — nothing calls `POST /api/agents` to register Claude/GPT presence yet, and its panel is currently static demo text, not live board events.
- End-to-end external-client proof (Codex): `jrl6933380-hub/buehler-services`, connector-created repo → branch → PR → Mr. Lopez merge → READY production deployment.

## NEXT

- Review and merge the Room account creation race fix, then continue task 09 with explicit tenant/project boundaries and provider-neutral cost attribution.

Read this file first, then `agent-lessons/`, before writing new code. Real next piece is **epic task 03, the Claude Routine wake-to-board vertical slice** — task 02 (dispatcher) is done and unblocks it. Task 05 (E2B workspace manager) is also unblocked. **Task 08 (Mission Control → real event-driven telemetry) is worth prioritizing sooner than its number suggests** — Mr. Lopez wants to watch live agent work happen behind Nex's chat box in real time (his own words: "like a bootleg Replit"), and the panel currently shows frozen demo text. That's the whole gap, not a new feature to invent. Codex: unreviewed pricing thesis from you still sitting in the LOG below. Elicitation-based approval flow (task 06) is designed but not built.

## BLOCKERS

- **Sandbox and production share one Redis — needs a decision from Mr. Lopez.** Now that sandbox can actually reach Redis, it turns out to be pointed at the SAME Upstash store as production: the sandbox board returns production's identical task list and message log. The earlier "sandbox is isolated" finding was only true because sandbox couldn't reach Redis at all. Nobody chose this; it's whatever `upstash-kv-sky-lever` supplied. Consequence: any "sandbox" board write IS a production board write, which directly contradicts SANDBOX.md's rule against production Redis keys. Options: (a) accept it and delete that rule, or (b) provision a second Upstash store for sandbox and repoint it. Do not treat sandbox board writes as safe/isolated until this is settled.

## DECISIONS

- `BRIDGE.md` is the canonical continuity file; all three agents may update it directly. One current STATUS + one concrete NEXT beats a long transcript.
- Repository: `jrl6933380-hub/nexus-labs`, default branch `main`. Sandbox work happens in `jrl6933380-hub/nexus-labs-sandbox`; anything meant to last gets ported to production properly, not just merged in the sandbox.
- The real MCP connector Claude uses is `jrl6933380-hub/github-write-mcp` — a separate repo from `nexus-labs` itself. `nexus-labs/api/mcp.js` is a smaller, unrelated internal endpoint.
- Epic task 01's `workspace_ref` (E2B) field was left out on purpose — task 03 uses the Claude Routine's own built-in sandbox.
- Nex's Agent Board actions execute immediately (coordination, not files). His file-write tools are branch-conditional: any non-default branch executes immediately (build mode), the live/default branch always queues for approval — enforced in code (`isLiveBranch` in `lib/nexBrain.js`), not by prompting alone.
- Rule 11's Vercel cross-check is Claude/Codex only — Nex has no Vercel tools by design.
- `agent-lessons/` is for durable, specific, signed lessons, not a changelog — that's what this LOG is for.
- A Claude Code session and this chat are separate agents that happen to share a model — both are expected to read/write BRIDGE.md and the board independently, same as Codex does.
- **Per-user approval delivery uses MCP elicitation, not a custom Nexus UI.** Mr. Lopez's own dashboard/SMS approval flow stays as-is. For anyone else's connected AI, Nexus should use elicitation rather than building/hosting any approval UI ourselves. Only works if the connecting client supports it — task 06 needs a defined fallback (treat as declined) for clients that don't.
- **"Jump to the other app" link convention:** neither Claude nor Codex can actually detect whether the other product's app is authenticated on Mr. Lopez's phone — there is no API for that. As a proxy, when either agent finishes a `read_board`/board-update action, check recent board messages for activity `from` the other named agent within the current session. If the other agent has posted recently, offer its link; if not, skip it — don't offer on a stale or absent signal. This is board-presence, not real connection-status; say so if asked.
  - **The link is the plain product root and nothing else: `https://chatgpt.com` for Codex/ChatGPT, `https://claude.ai` for Claude.** Do NOT append a path. In particular `chatgpt.com/codex` is WRONG — Codex is a feature surface, not the app, and the goal is for mobile OS link-handling to open the installed app. Claude got this wrong on 2026-09-02 even with the rule already written, hence the emphasis. Same principle applies to any future agent added here: root domain only.
- **"Instant local UI edit" is a real, standing capability, not a one-off:** because Claude/Codex have direct commit access and Vercel auto-deploys on push to `main`, cosmetic or behavioral requests about the live Nexus UI ("that color feels off", "show status as a pulsing dot") can go straight from Mr. Lopez's words to a live, deployed change — no ticket, no separate design pass, no waiting on someone else. Small/reversible changes (color, copy, spacing) can go straight to `main`; anything touching board/data logic still follows the normal PR review discipline above.

## LOG

- [2026-09-05] [CODEX] — Verified PR #54 was merged and its post-merge production deployment is READY. Found and fixed the concurrent Room signup overwrite race on a separate branch using atomic Redis account creation; full suite passes 114/114.
- [2026-09-02] [CODEX] — Implemented the explicit `Nex disengage` → real Claude Routine handoff on a feature branch. Claude is constrained to read shared context and wait for fresh instructions; handoff itself grants no write/deploy/credential authority. Added `Nex engage` and command/wake failure tests. Main remains untouched pending PR review.
- [2026-09-02] [CLAUDE] — Added rule 14 (Vercel deep-links instead of verbal nav steps) and logged the "instant local UI edit" capability as a DECISION, after walking Mr. Lopez through Vercel's mobile UI by hand and realizing a direct link would've skipped most of it. Flagged task 08 (live Mission Control telemetry) as worth prioritizing — it's the actual feature Mr. Lopez is asking for ("talk to you, background is live work"), not a new idea.
- [2026-09-02] [CLAUDE] — Fixed the sandbox board 500. Diagnosed that the env vars were never wrong (they were correct and Production-scoped); the live build just predated them. Forced a real production deploy via `aa188e1`; `/api/board` now returns 200, verified directly. Added rule 13. Discovered and flagged that sandbox now shares production's Redis — logged as a BLOCKER needing Mr. Lopez's decision. Tightened the jump-link convention to root-domain-only after using the wrong URL myself.
- [2026-09-02] [CLAUDE] — Corrected stale STATUS (task 01/02 were marked unmerged/blocking; both are actually merged and complete, verified by re-reading files + re-running tests). Documented the board-presence link convention as a DECISION. Housekeeping: PR #3/#5 test-artifact merge+cleanup on sandbox noted.
- [2026-09-02] [CLAUDE] — `github-write-mcp` shipped gated `merge_pull_request`, `list_repos`, `list_pull_requests` — all merged and live, verified against `main` directly.
- [2026-09-02] [CLAUDE] — Epic task 02 (dispatcher) merged to sandbox `main` (PR #4) after verifying no drift and re-running the full test suite fresh (28/28).
- [2026-09-02] [CLAUDE] — Logged the MCP-elicitation approval-delivery design decision (task 06/09).
- [2026-09-02] [CLAUDE] — PR #7 (`list_repos` for Nex) merged, live-verified via a real `message_nex` call.
- [2026-09-01] [CODEX] — Proved the full external-client workflow with Buehler Services end to end. Raised a pricing thesis for Claude to evaluate — not yet reviewed.
- [2026-09-01] [CLAUDE] — Epic task 01 done: `lib/taskEnvelope.js`, 10 tests passing. PR #2 opened on sandbox (later merged, see above).
- [2026-09-01] [CLAUDE] — Shipped Nex's Agent Board tools, Stark UI + registry ported to production, `agent-lessons/` created, this file revived after going stale post-creation.
- [2026-09-01] [CODEX] — Created this bridge file.
