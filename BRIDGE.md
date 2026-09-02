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

- Production (`nexus-labs`, `main`) confirmed live and current: Stark/JARVIS UI, dynamic agent registry wired into `/api/board`, Nex's Agent Board tools, Nex's branch-scoped build mode, `agent-lessons/`, SMS approvals (still needs Twilio env vars + webhook config before actually usable), searchable/tagged memory, a longer Nex chat window (24 messages), and `listRepos()` for Nex (PR #7, merged and live-verified via real message_nex call).
- **CONFIRMED: `nexus-labs-sandbox`'s live board is isolated from production — and currently not connected to any Redis at all.** Split-brain test: posted `TEST_TOKEN_9f4a2` to the production board (confirmed present via `read_board`, real Redis-backed). `nexus-labs-sandbox.vercel.app/api/board` (verified via Vercel API as the project's actual current production alias, `dpl_3PVdpCtrTzXyDEKJmVqxtDkHnkKn`) returns `HTTP 500 {"error":"Missing KV_REST_API_URL or KV_REST_API_TOKEN"}` — no KV credentials are set on that project's Production environment at all, so it errors before ever touching Redis. Code-level: sandbox's `lib/board.js` uses identical env var names and Redis keys to production's, so this is a config gap, not a code difference — whoever fixes it needs to deliberately choose shared-with-prod vs. its own database. Until fixed, any board-based coordination that looked like it was happening "on the sandbox board" was never actually live against this endpoint. Newer preview URLs are now gated behind Vercel SSO and couldn't be checked directly; the production alias is the one that matters and is unambiguous. Not fixed — confirmed and documented only.
- E2B/`run_sandbox` — verified fixed AND live-tested.
- `nexus-labs-sandbox` `feature/task-envelope-v2` (PR #2, epic task 01, `lib/taskEnvelope.js`) IS merged into sandbox `main` — verified directly against the sandbox repo's git history (earlier STATUS calling this "still unmerged" was stale, corrected here per rule 11/12). `feature/approval-aware-dispatcher` (PR #4) has epic task 02 (the dispatcher) built on top of it — 28/28 tests passing and Vercel preview READY per Codex, awaiting Mr. Lopez's merge. Given the board-isolation finding above, re-verify PR #4's claims of live board interaction against real Redis state (not just unit tests) before trusting it end-to-end.
- `nexus-labs-sandbox` `feature/dynamic-agent-registry` (PR #1) is superseded by production, safe to close without merging.
- Mission-orbit shows only Nex — nothing calls `POST /api/agents` to register Claude/GPT presence yet.
- End-to-end external-client proof (Codex): `jrl6933380-hub/buehler-services`, connector-created repo → branch → PR → Mr. Lopez merge → READY production deployment.
- New design decision logged (not yet built): use MCP **elicitation** for per-user approval prompts when someone else's connected AI needs to confirm a risky action — see board task "Use MCP elicitation for per-user approval prompts" and DECISIONS below. Relevant to task 06 and task 09.
- A second, independent Claude Code session has now done two real, verified sessions of work tonight (shipped `list_repos`, then ran and documented this split-brain test) — genuine board citizenship confirmed, not just plumbing.

## NEXT

Read this file first, then `agent-lessons/`, before writing new code. Immediate: (1) fix the sandbox board isolation — set `KV_REST_API_URL`/`KV_REST_API_TOKEN` on the `nexus-labs-sandbox` Vercel project's Production environment (deliberately choosing shared-with-prod vs. its own database); (2) once fixed, re-verify PR #4's (task 02, dispatcher) claims against real board state, then merge it. After that: epic task 03, the Claude Routine wake-slice. Codex: unreviewed pricing thesis from you still sitting in the old LOG. Also worth designing task 06's elicitation-based approval flow once that work starts.

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
- **Per-user approval delivery uses MCP elicitation, not a custom Nexus UI.** Mr. Lopez's own dashboard/SMS approval flow stays as-is — that's his personal interface. For anyone else's connected AI, Nexus should use elicitation (server pauses a tool call, sends a structured confirmation request through the client, the client's own app surfaces it however it already does) rather than building/hosting any approval UI ourselves. Only works if the connecting client supports elicitation (most modern ones do, not universal) — task 06 needs a defined fallback (treat as declined) for clients that don't.
- **`nexus-labs` and `nexus-labs-sandbox` each connect to Redis directly with matching key names — this does NOT mean they share data.** Verify actual reachability (a real request against the current production alias, confirmed via the Vercel API, not a remembered URL) before assuming two same-named endpoints agree with each other.

## LOG

- [2026-09-02] [CLAUDE] — Board-integrity split-brain test: posted TEST_TOKEN_9f4a2 to the production board, then checked sandbox's actual current production deployment (confirmed via Vercel API, not a remembered preview URL). Result: sandbox's `/api/board` returns 500, no KV credentials configured at all — isolated from prod, and not connected to any Redis right now. Also corrected a stale STATUS claim along the way: PR #2 (task envelope) IS merged into sandbox `main` (verified directly), contradicting the old "still unmerged" line. Documented with curl evidence, posted to the production board, did not attempt a fix (out of scope for this check).
- [2026-09-02] [CLAUDE] — Logged a real design decision: use MCP elicitation for per-user approval prompts (task 06/09), instead of building custom approval UI for other people's connected AIs. New board task created with the mechanism and two known caveats (client support isn't universal; streaming-pause plumbing needs real review).
- [2026-09-02] [CLAUDE] — PR #7 (`list_repos` for Nex) merged, then live-verified via a real `message_nex` call — closes the fix-everything pass entirely.
- [2026-09-02] [CLAUDE] — Second live Claude Code session came online, confirmed BRIDGE.md and read_board agree, picked up and shipped the `list_repos` fix (self-corrected a mis-claimed task along the way).
- [2026-09-01] [CLAUDE] — Fix-before-new-work audit: live-verified E2B, confirmed the `list_repos` gap, discovered PR #1 and PR #3 were built/tested but never merged. PR #3 merged; PR #1 rebuilt clean as PR #5. Added rules 11–12.
- [2026-09-01] [CODEX] — Proved the full external-client workflow with Buehler Services end to end. Raised a pricing thesis for Claude to evaluate — not yet reviewed.
- [2026-09-01] [CODEX] — Recovered/verified Claude's build-mode work was live, then independently confirmed it end-to-end via a real branch write through Nex.
- [2026-09-01] [CLAUDE] — Epic task 01 done: `lib/taskEnvelope.js`, 10 tests passing. PR #2 open on sandbox.
- [2026-09-01] [CLAUDE] — Shipped Nex's Agent Board tools, Stark UI + registry ported to production, `agent-lessons/` created, this file revived after going stale post-creation.
- [2026-09-01] [CODEX] — Created this bridge file.
