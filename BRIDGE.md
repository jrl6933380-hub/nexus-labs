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
12. **A PR sitting open is not the same as shipped.** Before marking anything STATUS as "done," confirm the actual file exists on `main` — not just that a PR exists for it. Two features (searchable memory, SMS approvals) sat fully-built-and-tested but unmerged for hours tonight because nobody checked this.

## STATUS

- Production (`nexus-labs`, `main`) confirmed live: Stark/JARVIS UI, dynamic agent registry wired into `/api/board`, Nex's Agent Board tools, Nex's branch-scoped build mode, `agent-lessons/`, SMS approvals (`lib/sms.js`, `api/sms-webhook.js` — merged, but still needs Twilio env vars + webhook config before actually usable), searchable/tagged memory (merged via PR #5), and a longer Nex chat window (merged via PR #6).
- E2B/`run_sandbox` incident from earlier tonight (crashed import in `github-write-mcp`'s `api/mcp.js`) — verified fixed AND live-tested by Claude (`run_sandbox` executed a real command, correct output). Not just code review.
- `list_repos` tool for Nex: PR #7 open on `nexus-labs` (`claude/nexus-labs-agent-setup-1ule17` -> `main`) — `lib/github.js` gets `listRepos({owner})` (pages `/user/repos`, private repos included, optional owner filter), wired into `lib/nexBrain.js` TOOLS + dispatch. `node --check` clean, existing regression suite still 3/3, plus a local mocked-fetch smoke test of pagination/filtering. Not yet merged, not yet live-tested via Nex.
- `nexus-labs-sandbox` `feature/task-envelope-v2` (PR #2) has epic task 01 (`lib/taskEnvelope.js`) — unmerged, blocks task 02.
- `nexus-labs-sandbox` `feature/dynamic-agent-registry` (PR #1) is superseded by production, safe to close without merging.
- Mission-orbit shows only Nex — nothing calls `POST /api/agents` to register Claude/GPT presence yet.
- End-to-end external-client proof (Codex): `jrl6933380-hub/buehler-services`, connector-created repo → branch → PR → Mr. Lopez merge → READY production deployment.
- Second live Claude Code session confirmed working as a genuine board citizen tonight (this session) — read BRIDGE.md + read_board, found them in agreement, picked up the `list_repos` gap per plan.

## NEXT

Read this file first, then `agent-lessons/`, before writing new code. Immediate: (1) review/merge PR #7 (`list_repos` for Nex), then live-verify via `message_nex` that he can actually call it and it returns real repos. After that: epic task 02, the dispatcher — routes by required_capabilities/risk_class/approval_state to an available agent, idempotent claim/lease. Builds on `lib/taskEnvelope.js` once PR #2 (sandbox) merges.

## BLOCKERS

None currently.

## DECISIONS

- `BRIDGE.md` is the canonical continuity file; all three agents may update it directly. One current STATUS + one concrete NEXT beats a long transcript.
- Repository: `jrl6933380-hub/nexus-labs`, default branch `main`. Sandbox work happens in `jrl6933380-hub/nexus-labs-sandbox`; anything meant to last gets ported to production properly, not just merged in the sandbox.
- The real MCP connector Claude uses is `jrl6933380-hub/github-write-mcp` — a separate repo from `nexus-labs` itself. `nexus-labs/api/mcp.js` is a smaller, unrelated internal endpoint; don't confuse the two when debugging connector issues.
- Epic task 01's `workspace_ref` (E2B) field was left out on purpose — task 03 uses the Claude Routine's own built-in sandbox. Add back if a worker type without one shows up.
- Nex's Agent Board actions execute immediately (coordination, not files). His file-write tools are branch-conditional: any non-default branch executes immediately (build mode), the live/default branch always queues for approval — enforced in code (`isLiveBranch` in `lib/nexBrain.js`), not by prompting alone.
- Rule 11's Vercel cross-check is Claude/Codex only — Nex has no Vercel tools by design.
- `agent-lessons/` is for durable, specific, signed lessons, not a changelog — that's what this LOG is for.

## LOG

- [2026-09-02] [CLAUDE] — Second live Claude Code session came online, confirmed BRIDGE.md and read_board agree (wiring test passed), then picked up the `list_repos` gap Nex flagged. Corrected an early board mistake (claimed the wrong task id, released it back to idle) before creating the right one. Shipped `listRepos()` in `lib/github.js` + wiring in `lib/nexBrain.js`, verified with `node --check`, the existing regression suite, and a local mocked-fetch smoke test — PR #7 open on `nexus-labs`, not yet merged or live-tested via Nex.
- [2026-09-01] [CLAUDE] — Fix-before-new-work audit: live-verified the E2B fix (`run_sandbox` actually executed), confirmed a real open gap (`list_repos` missing for Nex), and — critically — discovered PR #1 (searchable memory) and PR #3 (SMS) were fully built/tested but never merged. PR #3 now merged by Mr. Lopez. PR #1 had gone stale (conflicted with `nexBrain.js` changes from board-tools/build-mode work) — rebuilt clean as PR #5 on current `main`, tests re-verified locally (3/3) before opening. Added rules 11–12 here specifically so "PR exists" stops getting mistaken for "shipped."
- [2026-09-01] [CODEX] — Proved the full external-client workflow with Buehler Services end to end. Raised a pricing thesis for Claude to evaluate (platform subscription vs. BYOAI/BYOK vs. managed credits vs. outcome-based vs. hybrid) — not yet reviewed.
- [2026-09-01] [CODEX] — Recovered/verified Claude's build-mode work was live, then independently confirmed it end-to-end via a real branch write through Nex.
- [2026-09-01] [CLAUDE] — Epic task 01 done: `lib/taskEnvelope.js`, 10 tests passing (verified locally). PR #2 open on sandbox.
- [2026-09-01] [CLAUDE] — Shipped Nex's Agent Board tools, Stark UI + registry ported to production, `agent-lessons/` created, this file revived after going stale post-creation.
- [2026-09-01] [CODEX] — Created this bridge file.
