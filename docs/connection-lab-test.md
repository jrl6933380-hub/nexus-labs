# Fresh MCP / fresh App connection test

The Connection Lab is independent of all Nexus account connections. Its endpoint
imports no workspace services, token stores, OAuth code or account data. It exposes
two uniquely named read-only tools and a small interactive receipt board. No
account or saved records are created. Its responses are public test fixtures.

## 1. Deploy the server

Merge this change and confirm Vercel has deployed it. The MCP URL is:

`https://nexus-labs-sigma.vercel.app/api/connection-lab-mcp`

MCP uses POST; opening this URL in a browser returns 405, not a webpage. The
interactive HTML is served through the MCP resource linked by the board tool.

## 2. Register one fresh App

Create **Nexus Connection Lab** using that server URL and **Authentication: None**.
Use the newly assigned App ID, not the existing Nexus Workspace App ID.

The available Plugin Creator tools can bind an existing App ID but do not expose
the New App registration action. This one-time registration is a separate setup
step before testing the install prompt. Do not delete or disconnect the working
Nexus Workspace App to run this isolated test.

## 3. Run the install prompt

Replace `<NEW_APP_ID>` with the complete registered App ID. Keep one test plugin
and update it in place on subsequent iterations:

> @Plugin Creator Create one private plugin named Nexus Connection Lab for
> ChatGPT mobile and web. Attach the existing App `<NEW_APP_ID>` using a valid
> .app.json binding. Reuse its tools and authentication. Include a skill that
> calls show_connection_test_board to open its real test board. Do not create
> another App or standalone MCP connection, and do not substitute Nexus Workspace
> tools. Verify the saved App binding. If attachment or tool access fails, report
> the error instead of creating a desktop-only substitute. If this test plugin
> already exists, update it rather than creating a duplicate.

## 4. Check the result

Select the new plugin in a fresh chat and ask **Open the connection test board**.
Confirm the unique `show_connection_test_board` tool was used. The board should
show a server timestamp and response receipt. Tap **Verify live connection**.
That button generates a challenge, calls `refresh_connection_test_board`, checks
the returned challenge, and reports success only when it matches.

A successful test establishes fresh App attachment, tool discovery, mobile board
rendering, and an interactive server round trip for that ChatGPT account. It does
not establish another account's access to the App ID, create a customer identity,
or prove persistent customer authorization. Those remain separate tests.

## Automated checks

`node --test test/connection-lab-mcp.test.mjs`

The official MCP client and the actual widget script verify discovery, the HTML
resource, fresh receipts, strict schemas, unique tool names, both host bridges,
and failure states using an isolated local server. Actual ChatGPT installation
and visual rendering require a host test after deployment and App registration.
