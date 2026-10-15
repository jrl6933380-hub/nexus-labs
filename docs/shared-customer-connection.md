# Shared customer Nexus Board connection (test rollout)

The private owner connector at `/api/workspace-mcp` keeps its OAuth flow. Existing
per-customer `/api/customer-mcp/nxc_…` addresses remain supported.

## Configure one customer App

In the existing plugin's **Add app** screen, create one customer App with:

- Name: **Nexus Customer Board**
- Server URL: `https://nexus-labs-sigma.vercel.app/api/customer-board-mcp`
- Authentication: **None**

Create this App only after the endpoint has deployed. This is one shared customer
connection, not one App per customer. Do not replace the private owner's OAuth
App or share an owner's GitHub/Vercel connector. Plugin Creator's archive upload
alone does not perform this App registration.

Customers need access to the resulting App/plugin through a supported sharing or
publication route. A private personal App is not automatically available to all
customers. That distribution and actual ChatGPT mobile operation still require
host verification; these server changes do not publish the plugin.

## Test the signup handoff

Open `https://nexus-labs-sigma.vercel.app/connect?shared=1`.

The existing signup creates or reuses a passwordless customer account. With
`POST /api/connect {"shared":true}`, it returns the shared MCP endpoint and that
customer's private `workspace_key`. The landing page opens ChatGPT with a short
request to use the shared customer app and pass that key. It does not ask Plugin
Creator to build another plugin. The user must enable the shared customer App.
The original `/connect` flow remains available during this test rollout.

The internal account ID is not a credential. The unguessable `nxc_…` key is the
credential. Every shared tool call requires it, and the server resolves it against
the existing token store before selecting any account. Revoking the address from
the connect page also revokes the shared key immediately. Deleted accounts and
operator usernames are refused. A username, account ID, cookie, MCP session ID,
or model-supplied owner flag cannot select another workspace.

This is an explicit credential handoff, not anonymous access or automatic
identification of a ChatGPT user. The private key appears in the user's setup
request and tool arguments. The assistant must not repeat it or save it as board
content. The server strips it before product services and the mutation journal.
It is returned only in widget metadata so real board buttons retain their scope,
never in the board snapshot or widgetState. The board does not put it in follow-up
messages. In a fresh chat without the key in context, reopen the connect page to
make the handoff again; no permanent user binding is claimed. OAuth remains the
separate route for a host-managed, durable account connection.

## Verification

`node --test test/shared-customer-mcp.test.mjs test/shared-customer-ui.test.mjs`

Tests use isolated data and the official MCP client to check public discovery,
required credentials, simultaneous customers, account-scoped writes/retries,
revocation, owner denial, credential removal from persisted tool inputs, metadata
handoff for board controls, and preservation of the original OAuth tool schemas.
Browser layout and actual installation/rendering in ChatGPT require host testing.
