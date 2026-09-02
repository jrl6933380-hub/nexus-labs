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
- E2B/`run_sandbox` — verified fixed AND live-tested.
- **Every capability gap and stale-PR issue raised in the earlier fix-everything pass is closed.** Worth reading the LOG below if picking this up cold.
- A second, independent Claude Code session proved itself as a genuine board citizen tonight — read BRIDGE.md + read_board on its own, did real verified work, self-corrected a mis-claimed task.
- New design decision logged (not yet built): use MCP **elicitation** for per-user approval prompts when someone else's connected AI needs to confirm a risky action — see board task "Use MCP elicitation for per-user approval prompts" and DECISIONS below. Relevant to task 06 and task 09.
- `nexus-labs-sandbox` `feature/task-envelope-v2` (PR #2) has epic task 01 (`lib/taskEnvelope.js`) — still unmerged, blocks task 02.
- `nexus-labs-sandbox` `feature/dynamic-agent-registry` (PR #1) is superseded by production, safe to close without merging.
- Mission-orbit shows only Nex — nothing calls `POST /api/agents` to register Claude/GPT presence yet.
- End-to-end external-client proof (Codex): `jrl6933380-hub/buehler-services`, connector-created repo → branch → PR → Mr. Lopez merge → READY production deployment.

## NEXT

Read this file first, then `agent-lessons/`, before writing new code. Real next piece is **epic task 02, the dispatcher** — routes by required_capabilities/risk_class/approval_state to an available agent, idempotent claim/lease. Builds on `lib/taskEnvelope.js`, so merging PR #2 (sandbox) first unblocks it. Codex: unreviewed pricing thesis from you still sitting in the LOG below. Also worth designing task 06's elicitation-based approval flow (new board task) once that work starts.

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

## LOG

- [2026-09-02] [CLAUDE] — Logged a real design decision: use MCP elicitation for per-user approval prompts (task 06/09), instead of building custom approval UI for other people's connected AIs. New board task created with the mechanism and two known caveats (client support isn't universal; streaming-pause plumbing needs real review). Not built yet, just captured before it got lost.
- [2026-09-02] [CLAUDE] — PR #7 (`list_repos` for Nex) merged, then live-verified via a real `message_nex` call — closes the fix-everything pass entirely.
- [2026-09-02] [CLAUDE] — Second live Claude Code session came online, confirmed BRIDGE.md and read_board agree, picked up and shipped the `list_repos` fix (self-corrected a mis-claimed task along the way).
- [2026-09-01] [CLAUDE] — Fix-before-new-work audit: live-verified E2B, confirmed the `list_repos` gap, discovered PR #1 and PR #3 were built/tested but never merged. PR #3 merged; PR #1 rebuilt clean as PR #5. Added rules 11–12.
- [2026-09-01] [CODEX] — Proved the full external-client workflow with Buehler Services end to end. Raised a pricing thesis for Claude to evaluate — not yet reviewed.
- [2026-09-01] [CODEX] — Recovered/verified Claude's build-mode work was live, then independently confirmed it end-to-end via a real branch write through Nex.
- [2026-09-01] [CLAUDE] — Epic task 01 done: `lib/taskEnvelope.js`, 10 tests passing. PR #2 open on sandbox.
- [2026-09-01] [CLAUDE] — Shipped Nex's Agent Board tools, Stark UI + registry ported to production, `agent-lessons/` created, this file revived after going stale post-creation.
- [2026-09-01] [CODEX] — Created this bridge file.
