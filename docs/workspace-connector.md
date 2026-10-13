# Nexus workspace connector bridge

`POST /api/workspace-connector` exposes product operations, not repository or operator tools.

Identity is resolved server-side. A private owner session or the internal `NEXUS_AGENT_API_TOKEN` maps Projects to `ownerWorkbenchUsername()` and Schedule/Reminders to `owner:<owner id>`. A Forge session maps to that user's Projects and `room:<username>` Schedule/Reminders. Input cannot select another account. The agent credential stays on the private connector server; never distribute it to customers.

Available actions: board, projects, project, save_project, import_form (owner only), schedule, create_event, update_event, delete_event, reminders, create_reminder, update_reminder, delete_reminder, usage. Supply `{action,input,request_id}`. Mutations require a stable request ID; identical retries replay the result. Unknown outcomes stay pending and require checking saved state instead of blindly repeating a write. The request journal and separate successful-action audit live in account-scoped Redis keys.

Projects reuse the real Workbench/history handler, account lock, plan allowance, and baseline checks. A successful save is read back before reporting success. FORM imports the bundled `public/demos/form-bodyweight.html` as `form-bodyweight-showcase`, preserving a previously imported copy and edits. Nothing publishes or invokes an AI model.

Schedule and Reminders use their existing stores. Explicit offsets or validated IANA timezones are required for local times. Phone alert delivery still depends on configured push and an enabled device. No email, SMS, external calendar or recipient actions were added.

Usage shown is the existing hosted-AI allowance, not a new connector-credit price. External AI costs are excluded. Product actions are audited separately and do not consume model allowance. Customer product-operation billing and checkout links need a separately approved pricing/billing integration; this change does not fabricate credits or Stripe URLs.

## Rollout

1. Deploy this bridge before enabling the paired `github-write-mcp` board tools.
2. Keep the owner connection private and configure its dedicated caller credential as described in that repo's workspace-board guide.
3. Refresh the connector's tools, load `show_nexus_board`, and use `import_form_project` to add FORM to the live owner account.
4. Verify the real ChatGPT host renders the packaged board and authorizes button tool calls.

This is the owner implementation, not a public customer launch. A public product-only MCP endpoint must have account-bound OAuth and must not inherit repository, admin or internal-agent credentials. Claude/Gemini visual host support still needs separate live verification. Demo-account seeding and recording follow after the live board is verified.

## Validation

Run `node --test test/workspace-connector.test.mjs test/room-history-storage-error.test.mjs` plus existing Workbench, planner and reminder tests. The paired connector has an isolated browser→SDK→handler→store verification script that uses this repo's `test/helpers/workspaceFixture.mjs` and the actual FORM HTML. No live data or GPU is used in these checks.
