# NEXUS LABS — CLAUDE ↔ CODEX ↔ NEX ↔ COPILOT BRIDGE

This is the shared continuity file for Claude, Codex (ChatGPT), Nex, and GitHub Copilot's cloud coding agent.

## RULES

1. Read this entire file before changing it.
2. Rewrite the whole file after reading; never write blind.
3. Keep these sections in this exact order: STATUS, NEXT, BLOCKERS, DECISIONS, LOG.
4. STATUS and NEXT describe the present and must be rewritten each handoff.
5. DECISIONS is append-only except when correcting an explicit factual error.
6. LOG is newest first. Stamp entries as:
   `[YYYY-MM-DD] [CLAUDE|CODEX|NEX|COPILOT] — what changed; what remains.`
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
15. **Copilot only ever sees this file if an issue body explicitly tells it to read it.** Copilot's cloud coding agent runs in a network-sandboxed session with no access to the live `/api/board` endpoint or any other agent's chat context — its only channel into shared state is the repo's own files, read during its session. It will NOT proactively check BRIDGE.md or the board on its own. Whoever assigns it a GitHub Issue (Justin, or Claude/Codex/Nex via a created issue) must include a line like "Read BRIDGE.md and agent-lessons/ for context before starting" in the issue body, or it starts with zero continuity. After its PR lands, whoever reviews it should append a LOG entry crediting `[COPILOT]` and summarizing what changed, same as any other agent.

## STATUS

- Multi-agent OS dispatcher (epic tasks 01/02) is genuinely live in **production** `nexus-labs` now, not just `nexus-labs-sandbox` — ported for real (`lib/taskEnvelope.js`, `lib/dispatcher.js`, `lib/boardDispatcher.js`), wired into a real `POST /api/dispatch` endpoint with a working audit-trail read path (`GET /api/dispatch?limit=N`). Verified live via direct file reads and deployment status, not trusted from PR descriptions.
- Task 10 (end-to-end reliability/security) closed three real "computed but never enforced" gaps in `lib/workspaceManager.js`/`lib/sandbox.js`: `network_allowlist`, `max_commands`, and `spend_cap_cents` (the last using E2B's real documented per-second pricing) are now genuinely enforced, not decorative fields. All merged and live.
- **Accessibility/mobile test suite exists (`e2e/accessibility.spec.mjs`, Playwright + `@axe-core/playwright`) but has never actually run end-to-end.** Headless-browser automation (Puppeteer, jsdom) reliably crashes in the dev sandbox agents use for verification — confirmed by direct isolated testing, not assumed. `.github/workflows/accessibility.yml` now exists on `main` (added manually by Justin, since the connector token lacks `workflow` scope — same root cause as board-integrity #7). First real run (`Create accessibility.yml #1`) failed in ~44s — too fast to have gotten through a real Chromium install + test pass, so it likely failed during `npm install` or `playwright install`, not on an actual accessibility finding. Nobody has read the actual log yet (requires GitHub sign-in; not fetchable by an agent).
- **GitHub Copilot's native cloud coding agent is active on this repo**, independently of the Claude/Codex/Nex board system — three branches exist (`copilot/nexus-labs-analytics`, `copilot/feature-implement-user-login`, `copilot/fix-login-button-error`) that nobody on the board has reviewed yet. Unknown whether they conflict with anything built here.

## NEXT

- Read the actual failed `Accessibility & mobile checks #1` run log (needs a signed-in human) and fix whatever's actually broken — likely an `npm install`/Playwright-install issue given the ~44s runtime, not a real accessibility violation yet.
- Review the three open Copilot branches for conflicts with recent work before anything merges.
- Since Copilot is a first-party GitHub App, it likely has the `workflow` write scope the connector token lacks — worth testing whether Copilot can be assigned exactly this class of task (workflow files, anything blocked by board-integrity #7) going forward instead of requiring Justin's manual paste each time.

## BLOCKERS

- **Connector token lacks the `workflow` OAuth scope** — cannot create/edit anything under `.github/workflows/` (confirmed via direct 403). This is board-integrity #7's root cause and also blocked the accessibility CI file from being pushed by an agent; Justin added it manually. Options: grant the token broader permissions, or route workflow-file tasks to Copilot instead (see NEXT).
- Sandbox (`nexus-labs-sandbox`) and production share ONE Redis — unresolved, not a deliberate choice, treat sandbox board writes as production writes until this is settled.

## DECISIONS

- `BRIDGE.md` is the canonical continuity file; all four agents may update it directly. One current STATUS + one concrete NEXT beats a long transcript.
- Repository: `jrl6933380-hub/nexus-labs`, default branch `main`. Sandbox work happens in `jrl6933380-hub/nexus-labs-sandbox`; anything meant to last gets ported to production properly, not just merged in the sandbox.
- The real MCP connector Claude uses is `jrl6933380-hub/github-write-mcp` — a separate repo from `nexus-labs` itself. `nexus-labs/api/mcp.js` is a smaller, unrelated internal endpoint.
- Nex's Agent Board actions execute immediately (coordination, not files). His file-write tools are branch-conditional: any non-default branch executes immediately (build mode), the live/default branch always queues for approval — enforced in code (`isLiveBranch` in `lib/nexBrain.js`), not by prompting alone.
- Rule 11's Vercel cross-check is Claude/Codex only — Nex has no Vercel tools by design.
- `agent-lessons/` is for durable, specific, signed lessons, not a changelog — that's what this LOG is for.
- **Per-user approval delivery uses MCP elicitation, not a custom Nexus UI.** Justin's own dashboard/SMS approval flow stays as-is.
- **"Jump to the other app" link convention:** neither Claude nor Codex can detect whether the other product's app is authenticated on Justin's phone. As a proxy, check recent board messages for activity `from` the other named agent within the current session before offering its link. **The link is the plain product root and nothing else: `https://chatgpt.com`, `https://claude.ai`.** Same principle applies to any future agent added here: root domain only.
- **"Instant local UI edit" is a real, standing capability:** because Claude/Codex have direct commit access and Vercel auto-deploys on push to `main`, cosmetic/behavioral requests about the live Nexus UI can go straight from Justin's words to a live, deployed change for small/reversible changes (color, copy, spacing); anything touching board/data logic still follows normal PR review.
- **Copilot is a fourth bridge participant with a different access model than the other three (see rule 15).** It has no board/API access and only sees this file when explicitly pointed at it. It may have broader native GitHub App permissions (e.g. `workflow` scope) than the connector token the other three agents use — worth deliberately routing permission-blocked tasks to it rather than treating that as a dead end each time.

## LOG

- [2026-09-06] [CLAUDE] — Added Copilot as a fourth bridge participant (rule 15) after Justin noted Copilot could be looped in via files it can already read, since it can't reach the live board API. Logged that Copilot is a first-party GitHub App and likely has `workflow` scope the connector token lacks — a real path to unblock board-integrity #7-class tasks going forward. Logged the unread Copilot branches and the accessibility CI run's fast (~44s) failure as open items needing a human or a future session to actually look at.
- [2026-09-05] [CODEX] — Verified PR #54 was merged and its post-merge production deployment is READY. Found and fixed the concurrent Room signup overwrite race on a separate branch using atomic Redis account creation; full suite passes 114/114.
- [2026-09-02] [CODEX] — Implemented the explicit `Nex disengage` → real Claude Routine handoff on a feature branch. Claude is constrained to read shared context and wait for fresh instructions; handoff itself grants no write/deploy/credential authority. Added `Nex engage` and command/wake failure tests.
- [2026-09-02] [CLAUDE] — Added rule 14 (Vercel deep-links) and logged "instant local UI edit" as a DECISION. Flagged task 08 (live Mission Control telemetry) as worth prioritizing.
- [2026-09-02] [CLAUDE] — Fixed the sandbox board 500 (env vars were never wrong; the live build predated them). Forced a real production deploy; `/api/board` verified 200. Added rule 13. Flagged sandbox/production sharing one Redis as a BLOCKER.
- [2026-09-02] [CLAUDE] — Corrected stale STATUS (task 01/02 were marked unmerged; both actually merged and complete, re-verified). Documented the board-presence link convention.
- [2026-09-02] [CLAUDE] — `github-write-mcp` shipped gated `merge_pull_request`, `list_repos`, `list_pull_requests` — merged and live.
- [2026-09-02] [CLAUDE] — Epic task 02 (dispatcher) merged to sandbox `main` after re-verifying no drift, full suite fresh (28/28).
- [2026-09-01] [CODEX] — Proved the full external-client workflow with Buehler Services end to end.
- [2026-09-01] [CLAUDE] — Epic task 01 done: `lib/taskEnvelope.js`, 10 tests passing.
- [2026-09-01] [CLAUDE] — Shipped Nex's Agent Board tools, Stark UI + registry ported to production, `agent-lessons/` created, this file revived.
- [2026-09-01] [CODEX] — Created this bridge file.
