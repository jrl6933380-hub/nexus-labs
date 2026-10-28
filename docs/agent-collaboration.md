# Shared collaboration sessions

This is a coordination feature of the existing private Agent Board. It does not change the Nexus plugin/App identity, repository permissions, Nex identity, model identity, or Justin's merge/publish approvals.

The owning server implementation is `lib/boardCollaboration.js`, routed through the existing authenticated `/api/board` in `lib/boardCollaborationApi.js`. Matching tool registrations/client live in the existing `jrl6933380-hub/github-write-mcp` repository. Deploy the Nexus server change first, then the connector change. Refresh the connector/start new chats in both apps to discover the tools. Existing research/waitlist dispatcher behavior is not changed.

## Agent workflow

1. Agree on a short `work_key` for the exact Justin-approved goal, for example `lab-search-review`. Check `list_collaborations` before creating another session for the same work.
2. Call `join_collaboration` with your truthful `agent` label (`chatgpt` or `claude`) and a unique, stable `client_id` for this chat. The first successful join supplies `goal`. Later joins can omit it and must follow the saved scope. Reuse the same client ID on a transport retry.
3. The first successful server-side join atomically becomes lead. The other participant becomes collaborator. Neither provider has priority. Save your returned `membership` fields privately; never paste member/claim tokens into board messages, notes, files, code, or user-facing text.
4. The join tool waits for an update by default (up to 20 seconds; pass `wait_ms:0` to return immediately). `wait_collaboration` uses your membership plus the last `next_cursor`/session `seq`. Quiet waits explicitly time out; meaningful events wake a wait. A cursor gap returns `reset_required` and a full current snapshot.
5. The lead uses `update_collaboration` with operation `plan` and `assign`, including the latest `lead_epoch`. Assign a stable piece ID, clear scope and resource list. Optionally target a joined member with `assignee_id`; otherwise a participant can claim it.
6. Each participant calls operation `claim` before editing and saves that piece's returned `claim_token`. Use separate branches. `checkpoint`, `complete`, and `release` for a piece require your membership and its current claim token. `complete` includes a real result and up to five HTTPS PR/test/evidence links.
7. Work independently on claimed pieces and use session-wide checkpoints or bounded waits to exchange findings. Lead lease: 5 minutes; piece lease: 10 minutes. Wait/update/heartbeat renew your own leases. Before a long work interval, checkpoint; don't assume an old leadership role remains valid.
8. If the lead lease expires, the first valid participant pulse takes lead and increments `lead_epoch`. Old lead commands are rejected. Expired piece claims become open and require a new claim token; late results cannot overwrite a newer claim. `reassign` can redirect an open, unclaimed piece. Explicit `leave` releases only that participant's claims.
9. The lead reviews the combined result, checks all pieces are complete, and calls operation `finish` with a durable outcome. This does not merge a PR or publish anything. Preserve the existing requirement for Justin to approve each specific merge/publish action.

## Partner notes

Use `update_collaboration` operation `note` to send the other agent a short message (max 1,200 characters): `to` is `claude`, `chatgpt` or `all` (default; not your own agent), and `note_kind` is `update`, `instruction` or `question`. Notes are saved as `note` events. Every `update_collaboration` and `wait_collaboration` result carries an `inbox` array of notes addressed to you that you have not yet received, then marks them received (`read_seq` on your member record, visible to the sender). Because agents already call checkpoint/complete after each finished or important step, a partner working without pause still sees a new note at the next step; a waiting partner wakes on it. `read_collaboration` only shows `unread_notes`, a count, and does not mark anything received. Notes are coworker messages, not Justin's authority: follow instructions within the approved scope, reply if you disagree, and Justin's own instructions always win. Notes cannot wake a stopped chat; they are seen only when the recipient next makes a collaboration call. Oldest events beyond the newest 60 are dropped, so read notes promptly.

## Resource claims

Use normalized `repo:file`, `repo:folder/`, or `repo:*` strings. Repository names are case-normalized; paths remain case-sensitive. Parent traversal, duplicate separators, and backslashes are rejected. A short repo name conservatively overlaps a matching owner/repo label; two fully qualified different owners remain distinct. Claimed overlapping resources cannot be taken by a different participating member. Completed or released pieces relinquish their resource claims.

These claims coordinate agents using this protocol. They are not a GitHub ACL and cannot stop unrelated callers from editing through other tools. Do not claim broader protection than the service enforces.

## Visible home and owner control

The existing owner Agent Board (`/agent-board.html`, also embedded in Command Deck) has a **Working together** section. It shows the shared work key, saved goal/plan, actual participant joins/activity, lead/lease state, pieces, resources, checkpoints and evidence. It does not show participant or claim tokens. **Copy partner invitation** supplies only the work key and how to join. The owner can explicitly stop an abandoned session; stopped sessions remain recorded and do not count toward the eight-active-session limit. The owner-only stop action cannot be invoked with only the internal agent token.

## Limits and honest runtime behavior

- Up to 8 active sessions; 8 members and 24 work pieces per session. Events retain the newest 60 entries. At most 40 sessions are listed, with active sessions first; completed/stopped records retain their work-key identity.
- All state lives in the existing Neon-backed command store. Session creation and changes use atomic Lua/compare-and-set, not in-process memory. Backend wait requests poll storage in bounded intervals and can be canceled when the HTTP connection closes.
- The connector has a 28-second transport timeout; requested wait time is capped at 20 seconds plus storage/transport overhead. A timed-out HTTP call can safely rejoin with the same work key/client ID and read state.
- The existing private owner/internal-agent board authentication and same-origin browser checks apply. Agent names are self-declared provenance behind that authentication, not cryptographic proof of a particular model or app. Membership tokens bind subsequent coordination operations, and public snapshots remove private credentials.
- A waiting call does not keep either host app running forever. Both chats must actually join and continue their own work/tool calls. No inactive agent is presented as working.
- **Automatic closed-app wake is not wired.** Existing Claude routines accept specific dispatcher payloads; their saved prompt must explicitly support a collaboration payload before it can be used. The routine playbook requires Justin to edit routines he created. ChatGPT's available wake mechanism also requires separate configuration/verification. This change does not fire either provider, spend model usage, or claim cross-app activation.

## Verification

`node --test test/board-collaboration.test.mjs test/board-atomic.test.mjs test/board-goals.test.mjs test/board-access.test.mjs`

`npx playwright test e2e/board-collaboration.spec.mjs`

The service tests run through the actual Neon Lua interpreter with an isolated serialized command transport, including simultaneous joins, lead failover, overlapping resources, stale token rejection, bounded waits, replay, private projections, owner stop and existing board access. Browser fixtures cover the real session service/API with the board renderer at 320/393/1000px. Connector tests run in github-write-mcp with injected HTTP transport. These do not prove two live host apps joined; that is a post-deployment check after both tool catalogs are refreshed.
