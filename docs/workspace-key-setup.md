# Private workspace key setup

Open `/workspace-key-setup.html` while signed in to the Nexus owner account. Create usable key generates a cryptographically random 256-bit bearer key, stores only its SHA-256 digest in the owner's Redis key record, reads that record back and verifies it, then returns the raw key exactly once to this owner page. It never enters the model, tool output, page URL, browser storage, or server logs.

Copy key & hide awaits a successful clipboard write before clearing both the displayed value and the page's key variable. A blocked clipboard keeps it visible. Hide without copying, navigating away, and restored-page handling clear the page; reloading cannot retrieve the raw key. The clipboard and any locked-notes copy remain under the user's control.

Replacing a key requires an explicit action and confirmation; it invalidates the previous stored digest immediately. Concurrent first creations and replayed setup requests are handled atomically. The page needs an owner session and a same-origin POST; customers and cross-origin creation cannot issue keys. Internal verification requires the existing server-to-server agent credential and returns only `{valid}`.

The paired private connector verifies its incoming bearer credential against this endpoint on each product-tool call. No new Vercel secret entry or redeploy is needed when the key is created or replaced. Initial deployment of these two PRs is still required. Existing `NEXUS_WORKSPACE_CONNECTOR_TOKEN` configuration is superseded by the owner key store.

The key must be entered once through the private ChatGPT connection's secure bearer-authentication settings. This page cannot change ChatGPT settings automatically; a notes backup alone does not authenticate the connection. Keep the internal agent API token private. This owner setup is not customer OAuth and does not authorize sharing the dev connector with customers.

Tests: `node --test test/workspace-key-setup.test.mjs`. Browser verification: `node scripts/verify-workspace-key-ui.mjs` (requires the existing Playwright Chromium setup; `NEXUS_BROWSER_EXECUTABLE` can select a local binary). The checks use isolated storage and create no live credentials.
