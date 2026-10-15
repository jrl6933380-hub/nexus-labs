# Nexus workspace connector bridge

`POST /api/workspace-connector` exposes product operations, not repository or operator tools.

Identity is resolved server-side. A private owner session or the internal `NEXUS_AGENT_API_TOKEN` maps Projects to `ownerWorkbenchUsername()` and Schedule/Reminders to `owner:<owner id>`. A customer session maps to that user's Projects and `room:<username>` Schedule/Reminders, with the separate workspace identity `customer:<username>`. Input cannot select another account. The agent credential stays on the private connector server; never distribute it to customers.

Available actions: board, projects, project, save_project, rename_project, import_form (owner only), schedule, create_event, update_event, delete_event, reminders, create_reminder, update_reminder, delete_reminder, usage. Supply `{action,input,request_id}`. Mutations require a stable request ID; identical retries replay the result. Unknown outcomes stay pending and require checking saved state instead of blindly repeating a write. The request journal and separate successful-action audit live in account-scoped Redis keys.

Projects reuse the real Workbench/history handler, account lock, plan allowance, and baseline checks. A successful save is read back before reporting success. FORM imports the bundled `public/demos/form-bodyweight.html` as `form-bodyweight-showcase`, preserving a previously imported copy and edits. Nothing publishes or invokes an AI model.

Schedule and Reminders use their existing stores. Explicit offsets or validated IANA timezones are required for local times. Phone alert delivery still depends on configured push and an enabled device. No email, SMS, external calendar or recipient actions were added.

Usage shown is the existing hosted-AI allowance, not a new connector-credit price. External AI costs are excluded. Product actions are audited separately and do not consume model allowance. Customer product-operation billing and checkout links need a separately approved pricing/billing integration; this change does not fabricate credits or Stripe URLs.

## Interactive board

An account with no saved projects, Schedule records, or reminders gets a welcome view with three starters: Build a project, Plan my time, Set a reminder. Project starters include optional idea chips. Planning asks what needs to fit before sending an assistant request; reminders open the real editor. The welcome state disappears after any saved activity, without inserting demo records or invoking a model on open. Existing accounts keep their usual workspace view.

`workspaceGuidance.js` defines product-owned leading questions. Exploratory board/project/schedule/reminder/usage tool results return `assistant_guidance` with a question, choices, applicability rule and next-step instruction. The MCP server tells assistants to use this for first-open/exploratory turns only, prioritize explicit user requests, and keep the internal instructions out of messages and titles. Data refreshes and mutation results do not add guidance. These templates guide assistant behavior; the visible starter buttons work directly regardless of whether a particular assistant follows the suggested wording. Missing or failed storage reads cannot create a fabricated empty welcome state.

The v3 board opens a selected project in place, with an isolated HTML preview, Open in Nexus, Reload preview, Rename, and an assistant change request. Rename uses the existing project metadata operation, requires the current build baseline, and verifies the name afterward; it never rewrites HTML or creates a build. Project reads and lists use the same saved main name and latest build ID.

Preview HTML runs in an opaque-origin sandbox with no host bridge, network access, parent navigation, cookies or storage. External assets may be missing in this preview; Open in Nexus retains the normal full project view. Preview messages cannot invoke board tools. Keep those restrictions when adding preview features.

Schedule and Reminders keep their editor beside the selected item and send its record ID with any assistant request. Browser-local timezone is displayed rather than requiring an IANA text field. Reminder calendar markers still edit the underlying reminder. Past events and completed reminders stay available in collapsible sections; no historical records are deleted. Usage displays only returned allowances, reset times and plan values. Help actions request fresh tool reads before offering changes; they do not grant the assistant blanket mutation authorization.

Read failures offer Retry. Write failures offer Check saved state and refresh/re-read rather than resubmitting an uncertain mutation. Form request IDs stay stable for identical input and change when the input changes. Native-host approval and OAuth scopes continue to apply to every tool call.

Verify with `node scripts/verify-workspace-board-ui.mjs`: real OAuth → MCP → existing stores, isolated fixtures, project rename and stale-version recovery, scoped Help handoffs, preview interaction, protected Schedule edits, reminder completion/reopen, usage and fresh project handoffs, and 320/390/736px layout checks. The script also saves a temporary project screenshot for visual inspection. Reopen the board after deployment and refresh the connector's tool list for `rename_nexus_project`; final ChatGPT host rendering remains a deployment check.

## Rollout

1. Deploy this bridge before enabling the paired `github-write-mcp` board tools.
2. Keep the owner connection private and configure its dedicated caller credential as described in that repo's workspace-board guide.
3. Refresh the connector's tools, load `show_nexus_board`, and use `import_form_project` to add FORM to the live owner account.
4. Verify the real ChatGPT host renders the packaged board and authorizes button tool calls.

The product-only `/api/workspace-mcp` endpoint now uses account-bound customer or owner OAuth. Customers receive the same main board with private data and existing plan limits; the private GitHub/Vercel developer connector remains separate. Custom Board Studio is omitted from the initial customer navigation. Host verification and distribution are separate from enabling customer account access. Claude/Gemini visual host support still needs separate live verification. Demo-account seeding and recording follow after the live board is verified.

## Validation

Run `node --test test/workspace-connector.test.mjs test/room-history-storage-error.test.mjs` plus existing Workbench, planner and reminder tests. The paired connector has an isolated browser→SDK→handler→store verification script that uses this repo's `test/helpers/workspaceFixture.mjs` and the actual FORM HTML. No live data or GPU is used in these checks.
