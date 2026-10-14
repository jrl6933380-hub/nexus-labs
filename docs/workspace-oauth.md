# Nexus Workspace OAuth connection

The owner connects one product app to ChatGPT at:

`https://nexus-labs-sigma.vercel.app/api/workspace-mcp`

Choose **OAuth**, with dynamic client registration (no static client ID/secret), then sign in to the existing private Nexus owner account and explicitly approve the displayed permissions. No API key copying or Vercel secret entry is involved. The previous custom-key guide was incorrect for ChatGPT MCP; its old URL redirects to `/workspace-connection-guide.html`. Existing legacy key hashes are not deleted or converted into OAuth tokens.

The product endpoint exposes 16 workspace tools and the shared board, including account-scoped project rename. The board resource includes a dedicated domain in standard and ChatGPT-compatible metadata, with no external network/resource allowlists. It shows actual account data and calls tools through the host bridge. `show_nexus_board` displays it; `read_nexus_workspace` updates data without producing another board.

## OAuth contract

- SDK `mcpAuthRouter`, registration, authorization, token, revocation, and bearer middleware handle the protocol. The provider supplies durable Redis storage and existing Nexus owner consent. This is not a new password system.
- Discovery: `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/workspace-mcp`.
- Authorization-server routes: `/register`, `/authorize`, `/token`, `/revoke`, rewritten to the SDK handler. Registration is public-client (`none`) only; registered clients persist and have no client secret to paste.
- Owner-only first rollout. Callback URLs must exactly match the supported ChatGPT stable or callback-ID-specific redirect, or the exact owner-pilot Gemini callback copied from its connection screen. No arbitrary redirect origins, native loopback callbacks, SSRF metadata fetches, or unverified CIMD clients are accepted. Choose DCR in the app configuration.
- S256 PKCE is mandatory; the SDK validates it before exchange. Approval requests and codes expire, use atomic one-time consumption, and require the owner session plus same-origin/CSRF approval.
- Exact issuer identification (`iss`), state echo, resource audience, client binding and permissions persist through authorization and token exchange.
- Access tokens last at most one hour; refresh credentials rotate within a 30-day grant. Replayed refresh tokens revoke that grant's token family. Revocation and expiry are checked server-side on every tool call. Only credential hashes are used as storage keys.
- `workspace:read` and `workspace:write` are enforced per tool. Read-only tokens cannot save. Model input cannot choose a different account. Missing/expired access gets a standard HTTP `WWW-Authenticate` challenge; insufficient permission gets the MCP reauthorization challenge.
- The owner context maps Projects to the existing owner Workbench username and Schedule/Reminders to the same `owner:<id>` used by Nexus. Product actions reuse existing baseline checks, quota rules, account locks, mutation journal, and stores. No publishing, model calls, or GPU starts are added.

## Rollout and remaining work

Merge/deploy this change first. Create the **Nexus Workspace** OAuth app using the URL above, approve it, then load the board and import FORM into the live owner account. Keep the GitHub/Vercel **dev** connector separately; the paired connector cleanup removes its unsupported static-key workspace registration. No customer should receive that dev connector.

Actual ChatGPT host login/rendering must be verified after deployment. The SDK protocol and browser flow passed isolated end-to-end checks; those tests do not grant live permissions or change live account records. Public customer-account consent, other platforms' callback/visual compatibility, billing for connector operations, demo seeding and recording remain later rollout steps.

Checks:

`node --test test/workspace-oauth.test.mjs`

`node scripts/verify-workspace-oauth-ui.mjs`

The browser script uses the official OAuth client for discovery/DCR/PKCE/token exchange and real Nexus handlers/stores with isolated persistence. It verifies owner sign-in blocking, visible approval, callback return, actual FORM HTML import, Schedule creation, reminder completion, reload persistence, and 320px layout. Existing Workbench/planner/reminder regressions are also included in validation.

## Gemini owner pilot

Use the same `/api/workspace-mcp` URL in Gemini custom connected apps. Leave the advanced client ID/secret fields empty: this endpoint supports public-client DCR and S256 PKCE. The owner-pilot Google callback is explicitly allowed; neighboring account IDs, query strings, fragments, and other Google callback paths are rejected. This is not general Gemini customer onboarding. If Gemini changes the callback, approve and verify the new exact address before enabling it.

Server-side Gemini-shaped registration/consent/token tests pass. Actual Gemini login and board rendering still require a host test after deployment; do not claim visual compatibility from protocol tests.
