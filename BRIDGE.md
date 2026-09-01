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

## STATUS

- Production (`nexus-labs`, `main`) has: the Stark/JARVIS UI across all 4 pages, the dynamic agent registry wired into `/api/board`, Nex's Agent Board tools, SMS-based queue approvals (Twilio), and `agent-lessons/`.
- `nexus-labs-sandbox` branch `feature/task-envelope-v2` (PR #2, unmerged) has epic task 01: `lib/taskEnvelope.js` — task envelope, event, and capability-lease contracts, 10 tests passing. This is the schema task 02 (dispatcher) and task 03 (Claude Routine wake-slice) build on.
- `nexus-labs-sandbox` `feature/dynamic-agent-registry` (PR #1) is superseded by production and can likely be closed without merging.
- SMS approvals need `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `JUSTIN_PHONE_NUMBER` set in Vercel, and the Twilio webhook pointed at `/api/sms-webhook`, before they're actually live.
- Mission-orbit UI will show real agents once something calls `POST /api/agents` to register — nothing does yet, so it currently shows just Nex.

## NEXT

At the start of a session, read this file first, then check `agent-lessons/` before writing new code. Next real piece: epic task 02, the dispatcher — routes by required_capabilities/risk_class/approval_state (all defined in task 01's envelope) to an available agent from the registry, with idempotent claim/lease so duplicate triggers don't cause duplicate work. Build on top of `lib/taskEnvelope.js` once PR #2 (sandbox) is reviewed/merged. Before ending a session where something meaningful changed, update STATUS/NEXT/BLOCKERS here and add one LOG entry.

## BLOCKERS

- None.
- Mr. Lopez should not need to repeat context between Claude, Codex, and Nex as long as whoever ends a session updates this file and the next one actually reads it first.

## DECISIONS

- `BRIDGE.md` at the repository root is the canonical continuity file. All three agents may update it directly.
- One current STATUS and one concrete NEXT action are preferred over long transcripts.
- Repository: `jrl6933380-hub/nexus-labs`; default branch: `main`. Sandbox/experiments happen in `jrl6933380-hub/nexus-labs-sandbox`; anything meant to last gets ported to production properly (see agent-lessons/code-style.md on wiring gaps), not just merged in the sandbox.
- Epic task 01's `workspace_ref` (E2B) field was deliberately left out of the envelope schema — the Claude Routine wake-slice (task 03) uses the routine's own built-in sandbox, so it isn't needed yet. Add it back if a worker type without its own execution environment shows up.
- Nex-originated file writes may require Mr. Lopez to approve the queued action, so Nex updates can appear with a delay. Nex's Agent Board actions (read/create/claim/update/complete/post_message) execute immediately — they're coordination, not file changes.
- `agent-lessons/` is for durable, specific, signed lessons — not a changelog. This LOG section is the changelog; agent-lessons is for patterns that outlive any one task.

## LOG

- [2026-09-01] [CLAUDE] — Epic task 01 done: `lib/taskEnvelope.js` in nexus-labs-sandbox (branch `feature/task-envelope-v2`, PR #2). `createTaskEnvelope`/`validateTaskEnvelope` (rejects malformed payloads), `assertSameTenant` (rejects cross-tenant), `createEvent`/`validateEvent` for all 10 event types, `toEnvelope()` migrates old `lib/board.js` tasks on read without touching storage, `validateCapabilityLease()` documents the `lib/agents.js` registry contract without duplicating it. 10 tests, actually run locally with `node --test` before opening the PR — all passing. Next: task 02 (dispatcher) builds on this.
- [2026-09-01] [CLAUDE] — Shipped a full session's worth of work to production: Nex's Agent Board tools, SMS-based queue approvals (Twilio), Stark UI + agent registry ported from sandbox (fixed two real gaps: `/api/board` never called `listAgents()`, `queue.html` was missing a fallback `index.html` had), `agent-lessons/` created and seeded, and this BRIDGE.md revived after going stale since Codex made it.
- [2026-09-01] [CODEX] — Created the shared Claude ↔ Codex bridge after confirming the repository and protocol with Nex; next assistant should read this file first and update it at handoff.
