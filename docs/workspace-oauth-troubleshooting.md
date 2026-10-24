# Workspace OAuth: "Invalid client_id" after the Neon move

## Symptom

Reconnecting an app (for example ChatGPT) to `https://nexus-labs-sigma.vercel.app/api/workspace-mcp` ends at the Nexus authorize step with:

    {"error":"invalid_client","error_description":"Invalid client_id"}

The host may still list some tool names, but calls fail with "Unknown tool", and newer tools (for example `find_nexus_media`, `use_nexus_media`) are missing.

## Cause

The host (ChatGPT) registers once through dynamic client registration (`POST /register`) and then keeps reusing that `client_id` on every reconnect. The registration lives in the store under `nexus:workspace-oauth:v1:client:*`.

The store moved from Upstash Redis to Neon Postgres (`NEXUS_DATABASE_URL`, see `docs/neon-store.md`) on 2026-10-23. Every OAuth record in the production Neon database was created after that move, so a registration made before it does not exist. `/authorize` looks the client up, finds nothing, and the MCP SDK answers `invalid_client`.

This is expected behavior. Unknown client ids must stay rejected. Do not add a fallback that accepts them.

## What was verified (2026-10-24)

- Production uses one Neon project and one branch (`production`, the default). Register, authorize, token and MCP calls all read and write the same store.
- Fresh registrations persist: several post-move clients, grants, refresh tokens and a live access token exist in that store and work.
- The only registered clients are Claude's. There is no client with a ChatGPT callback.
- Discovery (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/api/workspace-mcp`) is healthy.
- `/api/workspace-mcp` registers every tool for every caller (including `show_nexus_board`, `describe_nexus_ad_vocabulary`, `find_nexus_media`, `use_nexus_media`). `find_nexus_media` and `use_nexus_media` are refused at call time for non-owner accounts, and are hidden on `/api/customer-board-mcp`.

## Repair (no server change needed)

The stale registration cannot be repaired, because the server never knew its client id. Create a fresh registration:

1. In ChatGPT, open the Nexus Workspace app settings and delete (disconnect and remove) the existing app. Plain "Reconnect" reuses the stale client id.
2. Add the app again with server URL `https://nexus-labs-sigma.vercel.app/api/workspace-mcp`.
3. Authentication: **OAuth** with dynamic client registration. Leave client id and client secret empty.
4. Sign in to the Nexus owner account on the Nexus approval page and approve `workspace:read` and `workspace:write`.
5. Start a new chat so the host reloads the tool list.

If the host offers a tool refresh, run it after the new connection is approved. Tool lists are cached per app by the host.

## Allowed callbacks

`https://chatgpt.com/connector_platform_oauth_redirect`, `https://chatgpt.com/connector/oauth/<callback-id>`, the Claude callbacks, and the owner-pilot Gemini callback. See `lib/workspaceOAuth.js` (`allowedWorkspaceRedirect`). A host that registers a different callback gets `invalid_client_metadata` at `/register`.

## Environment

Names only, set in the Vercel project for Production: `NEXUS_DATABASE_URL` (or `DATABASE_URL`) selects the Neon store, and `NEXUS_OWNER_ID` selects the owner account. Never paste their values into chats, docs or tickets.

## Known noise (not the cause)

Vercel logs show `ERR_ERL_FORWARDED_HEADER` / `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` from express-rate-limit on `/authorize` and `/token`. They are validation warnings that appear on successful requests too. Whether to set a proxy-aware key generator is a separate change.
