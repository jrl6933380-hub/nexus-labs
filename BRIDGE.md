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

- Production (`nexus-labs`, `main`) now has: the Stark/JARVIS UI across all 4 pages, the dynamic agent registry wired into `/api/board` (real agents, not demo data), Nex's Agent Board tools (read/create/claim/update/complete/message), and SMS-based queue approvals (Twilio).
- `nexus-labs-sandbox` still holds the original UI/registry work (PR #1, unmerged) — production now supersedes it; sandbox PR can likely be closed without merging.
- `agent-lessons/` exists at the repo root (README + ui-style.md + code-style.md) — specific, signed, dated notes for any agent on what's worth copying or avoiding. Add to it, don't let it go stale.
- SMS approvals need `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `JUSTIN_PHONE_NUMBER` set in Vercel, and the Twilio webhook pointed at `/api/sms-webhook`, before they're actually live.
- Mission-orbit UI will show real agents once something calls `POST /api/agents` to register — nothing does yet, so it currently shows just Nex.

## NEXT

At the start of a session, read this file first, then check `agent-lessons/` before writing new code. Next real piece of work: task 01 on the Agent Board (task envelope/contract schema) — foundation for the dispatcher and the Claude-Routine wake-to-board slice (task 03). Before ending a session where something meaningful changed, update STATUS/NEXT/BLOCKERS here and add one LOG entry.

## BLOCKERS

- None.
- Mr. Lopez should not need to repeat context between Claude, Codex, and Nex as long as whoever ends a session updates this file and the next one actually reads it first.

## DECISIONS

- `BRIDGE.md` at the repository root is the canonical continuity file. All three agents may update it directly.
- One current STATUS and one concrete NEXT action are preferred over long transcripts.
- Repository: `jrl6933380-hub/nexus-labs`; default branch: `main`. Sandbox/experiments happen in `jrl6933380-hub/nexus-labs-sandbox`; anything meant to last gets ported to production properly (see agent-lessons/code-style.md on wiring gaps), not just merged in the sandbox.
- Nex-originated file writes may require Mr. Lopez to approve the queued action, so Nex updates can appear with a delay. Nex's Agent Board actions (read/create/claim/update/complete/post_message) execute immediately — they're coordination, not file changes.
- `agent-lessons/` is for durable, specific, signed lessons — not a changelog. This LOG section is the changelog; agent-lessons is for patterns that outlive any one task.

## LOG

- [2026-09-01] [CLAUDE] — Shipped a full session's worth of work to production: (1) wired Nex's Agent Board tools into `lib/nexBrain.js` (he had none before — "queueing" silently did nothing); (2) built SMS-based queue approvals via Twilio (`lib/sms.js`, `api/sms-webhook.js`, `notifyQueue()` in `lib/queue.js`); (3) ported the Stark UI + agent registry from sandbox to production, fixing two real gaps found in review — `/api/board` never called `listAgents()` (demo data only), and `queue.html` was missing a fallback `index.html` already had; (4) created `agent-lessons/` and seeded it; (5) added the BRIDGE.md/agent-lessons check-in instruction to `IDENTITY.md` and documented Nex's board tools there, which were missing from it. Next agent: read STATUS above, the sandbox PR #1 can probably just be closed now.
- [2026-09-01] [CODEX] — Created the shared Claude ↔ Codex bridge after confirming the repository and protocol with Nex; next assistant should read this file first and update it at handoff.
