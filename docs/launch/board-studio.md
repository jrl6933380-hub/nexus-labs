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

## Catalog, full-size view and template exchange (#578 follow-up)

The shared workspace UI now provides **My board catalog**: title/purpose search,
scope/preview filters, updated/name sorting and a count of matching private kits.
No seed records or public listings are introduced. Catalog/selection state is
preserved across host remounts and discarded on an authenticated-account change.

**View board** hides workspace chrome and lets the existing restricted preview
use the available viewport. It requests ChatGPT fullscreen through the optional
`window.openai.requestDisplayMode` extension or the standard MCP Apps
`ui/request-display-mode` bridge when the host advertises support. A host refusal
is labeled honestly as expanded-in-chat, not fullscreen. **Back to workspace**
restores the account-scoped record controls. The preview keeps its opaque sandbox,
offline CSP and no host/tool bridge; larger viewing does not grant permissions.

**Share template** is a manual, review-gated copy workflow, not public publishing
or an invitation to the original account. The versioned JSON includes only the
kit spec (including preview HTML, skill and guidance). Saved collection entries,
account IDs, board IDs and baselines are excluded. Personal content embedded in
the spec cannot be reliably stripped: the user must inspect it and explicitly
approve copying. Clipboard denial selects the reviewed text for manual copying.

**Import template** first parses and reviews the shared content without writes.
Only the confirmed Create private copy action uses the existing save tool, with
a fresh board ID and replay-safe request ID. Server schema validation, ownership,
25-kit limit and preview restrictions remain unchanged. Imports grant no new
tools/integrations and include no saved records. This is lightweight template
exchange, not a public catalog, share URL, classroom sharing or live collaboration.

Sources for presentation support:
- https://developers.openai.com/plugins/reference (Request another presentation mode)
- https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts

Follow-up verification: 10 new deterministic DOM/host tests exercise the actual
widget handlers, including fullscreen refusal, MCP fallback, remount recovery,
catalog controls, review-gated copying, clipboard denial, two-stage import,
malformed input and account-switch cleanup. The 39 existing board/connector/OAuth
tests and 182 offline launch tests also pass. These are isolated fixtures, not
proof of live ChatGPT rendering, speech, or model operation. Actual iPhone
fullscreen, keyboard/layout behavior and cross-account template handoff still
need host testing after deployment. No paid pods or production test records used.

## Board conversation bar

The trusted shared viewer now shows Talk with your AI, an optional current-topic
field, Start/Explain/Hint/Practice draft starters, Send to chat and See replies in
chat. It remains visible in full-size view; the topic control folds away and
the composer has a bounded height for small screens. Starter buttons only fill
the draft. Submission sends the selected kit ID, the user's explicit topic and
message through the existing ChatGPT follow-up or MCP ui/message bridge. The
assistant is asked to read the kit and use its audience/teaching guidance rather
than defaulting to code editing. This creates no new model endpoint or paid pod.

Replies still appear in the surrounding ChatGPT conversation. See replies in
chat exits focused view and requests inline presentation. The isolated saved
HTML receives no host bridge, streamed replies or arbitrary tools. In particular,
the composer cannot see the lesson selected inside that HTML; it asks for the
topic rather than inventing lesson state. Dynamic lesson/answer synchronization
is a separate unimplemented capability. Nothing is saved merely by submitting
a learning message; progress writes still need the user's authorization.

Four additional deterministic tests cover both sending bridges, safe starter
drafts, uncertain-delivery draft retention and duplicate-submit protection.
53 selected tests and 182 launch regressions pass. Actual ChatGPT/iPhone typing,
keyboard/safe-area behavior, reply navigation and tutoring quality remain host
verification tasks. Fixture handoffs do not prove a live model response.

## Shared Site Stylist

The canonical playbook is packaged at
`plugins/nexus-workspace/skills/site-stylist/SKILL.md`. The server loads that same
file and supplies the complete text as versioned `shared_skills` task guidance
on workspace reads, owned project reads, creator reads and kit reads/saves.
Generic MCP clients need no separate personal skill installation to receive it.
Existing boards inherit it at read time: there is no record migration, baseline
change, user-skill rewrite or automatic visual redesign.

The playbook requires content-led composition, typography, imagery and interaction
decisions; unrelated sites should not be recolored versions of one template.
Existing brands, constrained edits, shared host controls, mobile usability and
accessibility take priority over forced novelty. Guidance does not grant tools,
override system/user instructions, retrain a model, start a build or publish.
New-project and board handoffs explicitly direct assistants to read the playbook
for requested visual work; tutoring/scheduling do not trigger a redesign.

The private plugin's source is version 0.3.0, adding Site Stylist and routing its
existing workspace/creator skills to the shared guidance. Connection, identity,
audience, presentation/default prompt, OAuth scopes and cached v2/v3 resources
remain unchanged. Template exports still carry only user kit specs; imported kits
receive current shared guidance on their next owned read.

Verification: six additional isolated regressions cover exact source parity,
legacy read-time inheritance with zero writes, new/creator/workspace/project
delivery, injection/tenant rejection, generic MCP clients and conditional handoff
guards. 59 selected tests and 182 launch-offline regressions pass. Syntax and
skill/package validation are separate from actual host or model behavior.
After merge/deploy, read an existing kit through the actual connection and check
the returned full playbook. Independent ChatGPT/Claude adherence and generated
visual quality remain unverified; no live model or paid pod ran for this change.

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
