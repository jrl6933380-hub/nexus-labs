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

## STATUS

- Production (`nexus-labs`, `main`) confirmed live and current: Stark/JARVIS UI, dynamic agent registry wired into `/api/board`, Nex's Agent Board tools, Nex's branch-scoped build mode, `agent-lessons/`, SMS approvals (still needs Twilio env vars + webhook config), searchable/tagged memory, a longer Nex chat window (24 messages), and `listRepos()` for Nex (PR #7, merged and live-verified).
- **Epic task 01 (task envelope) and task 02 (approval-aware dispatcher) are both merged to `nexus-labs-sandbox` `main` and complete** — corrected from a previous stale STATUS line that still called PR #2 unmerged. `lib/taskEnvelope.js`, `lib/dispatcher.js`, `lib/boardDispatcher.js` all live on sandbox `main`; verified by re-reading files directly (not trusting PR descriptions) and re-running the full test suite fresh in a sandbox (28/28 passing).
- `github-write-mcp` (the real connector) shipped a gated `merge_pull_request` tool plus `list_repos`/`list_pull_requests`, all merged and live — Claude can now check PR status across every repo without guessing names.
- E2B/`run_sandbox` — verified fixed AND live-tested.
- `nexus-labs-sandbox` had a throwaway test artifact (`NEX_BUILD_MODE_VERIFIED.md`, PR #3) merged then cleaned up (PR #5) — no functional change.
- Mission-orbit still shows only Nex — nothing calls `POST /api/agents` to register Claude/GPT presence yet.
- End-to-end external-client proof (Codex): `jrl6933380-hub/buehler-services`, connector-created repo → branch → PR → Mr. Lopez merge → READY production deployment.

## NEXT

Read this file first, then `agent-lessons/`, before writing new code. Real next piece is **epic task 03, the Claude Routine wake-to-board vertical slice** — task 02 (dispatcher) is done and unblocks it. Task 05 (E2B workspace manager) is also unblocked. Codex: unreviewed pricing thesis from you still sitting in the LOG below. Elicitation-based approval flow (task 06) is designed but not built.

## BLOCKERS

None currently.

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
- **"Jump to the other app" link convention:** neither Claude nor Codex can actually detect whether the other product's app is authenticated on Mr. Lopez's phone — there is no API for that. As a proxy, when either agent finishes a `read_board`/board-update action, check recent board messages for activity `from` the other named agent within the current session. If the other agent has posted recently, offer its plain product root as a tappable link (`https://claude.ai` for Claude, `https://chatgpt.com` for Codex/ChatGPT) so mobile OS link-handling opens that app directly. If the other agent hasn't shown up recently, skip the link — don't offer it on a stale or absent signal. This is board-presence, not real connection-status; say so if asked, don't imply certainty the tooling doesn't have.

## LOG

- [2026-09-02] [CLAUDE] — Corrected stale STATUS (task 01/02 were marked unmerged/blocking; both are actually merged and complete, verified by re-reading files + re-running tests, not trusting prior claims). Documented the board-presence link convention as a DECISION. Housekeeping: PR #3/#5 test-artifact merge+cleanup on sandbox noted.
- [2026-09-02] [CLAUDE] — `github-write-mcp` shipped gated `merge_pull_request`, `list_repos`, `list_pull_requests` — all merged and live, verified against `main` directly.
- [2026-09-02] [CLAUDE] — Epic task 02 (dispatcher) merged to sandbox `main` (PR #4) after verifying `lib/taskEnvelope.js`/`lib/agents.js` were byte-identical to main (no drift) and re-running the full test suite fresh (28/28).
- [2026-09-02] [CLAUDE] — Logged the MCP-elicitation approval-delivery design decision (task 06/09).
- [2026-09-02] [CLAUDE] — PR #7 (`list_repos` for Nex) merged, live-verified via a real `message_nex` call — closed the earlier fix-everything pass entirely.
- [2026-09-01] [CODEX] — Proved the full external-client workflow with Buehler Services end to end. Raised a pricing thesis for Claude to evaluate — not yet reviewed.
- [2026-09-01] [CLAUDE] — Epic task 01 done: `lib/taskEnvelope.js`, 10 tests passing. PR #2 opened on sandbox (later merged, see above).
- [2026-09-01] [CLAUDE] — Shipped Nex's Agent Board tools, Stark UI + registry ported to production, `agent-lessons/` created, this file revived after going stale post-creation.
- [2026-09-01] [CODEX] — Created this bridge file.
