# Board Studio — private creation foundation

Baseline: main `fe70ea5` (#577). Preserve existing Nexus board resources, OAuth,
Projects, Schedule, Reminders, replay protection and optional Simple view.

## User flow

Boards → Create a board → describe purpose/audience/constraints → creator skill
scopes visuals, actions, typed collections, tool requirements, permissions and
operating guidance → user confirms → assistant saves a private kit → My boards
→ continue scoping or preview the kit and use its account-scoped record controls.

Saved kits contain a purpose, audience, workflow, preview HTML, typed collections,
their own operating skill/guidance and unresolved tool requirements. A scope can
be saved without HTML. Existing kits and records use baseline checks; mutation
request IDs prevent replay. All kit/entry changes use an atomic compare-and-swap.
Schema changes cannot orphan or reinterpret saved records.

The implemented tools read kits, list collection entries and save typed entries.
They never install arbitrary tools, execute server code, publish, invoke a model,
change billing or grant access to other accounts/boards. User-authored guidance
is task context, not system authority. Custom integrations, grading, classroom
permissions and new tools require separately reviewed implementation and testing.
Generated HTML stays in an opaque, restricted preview. Persistent records use
the native controls below that preview; preview buttons are not automatically
connected to host tools.

This private prototype is capped at 25 kits per account and 50 entries per board,
4,000 characters per entry. Record deletion/retention automation, per-student
permissions, sharing and public release are not provided by this change. Do not
collect sensitive learner records or advertise unlimited history/classroom access.

## Evidence and release

39 selected board/MCP/OAuth tests pass with outbound provider requests blocked;
local-only HTTP tests exercise SDK registration, consent, scopes and tool calls.
182 existing launch regressions also pass. The creator skill passes validation
and an isolated algebra-board scoping trial; the trial identified missing
grading, per-student permissions and record-deletion support rather than
inventing those functions. No live records or paid pods were used for tests.

Run:

`node --import ./scripts/no-network-test-transport.mjs --test test/board-studio.test.mjs test/workspace-connector.test.mjs test/workspace-board-resource.test.mjs test/workspace-guidance.test.mjs test/workspace-oauth.test.mjs`

Then `npm run test:launch-offline`.

Browser/mobile rendering and the new controls inside the actual ChatGPT widget
remain unverified until the backend/UI PR is merged and deployed. The existing
private plugin identity, connection, presentation and permissions are preserved;
the added skill explicitly reports pending deployment when tools are absent.
Merge/deploy the backend, refresh the connection's tool inventory, and test a
small private tutor kit before using it as a functional demonstration in ads.
