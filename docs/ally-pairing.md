# Nexus Ally secure pairing — phase 1

This phase implements **pairing and heartbeat only**. It does not give Claude/ChatGPT access to the Ally screen, keyboard, shell, game files, or Qwen. Issue #868 covers later owner-approved control tools.

## Setup after deployment

1. Sign into Nexus as the owner and open `https://nexus-labs-sigma.vercel.app/ally.html`.
2. Tap **Generate five-minute code**.
3. On the Ally, download the reviewed `scripts/ally/connect.ps1` from the matching merged GitHub revision. Review before running. No curl-to-shell install is required.
4. In PowerShell, run `powershell -NoProfile -File .\connect.ps1 -Action Pair`, enter code.
5. Run `powershell -NoProfile -File .\connect.ps1 -Action Connect` in a visible PowerShell window.
6. Return to the owner page and press **Check Ally connection**. It should show `paired: true`, `active: true`.
7. Press Ctrl+C in the Ally's PowerShell console, or **Stop current session** on owner page. **Revoke Ally pairing** invalidates the token.

Token is encrypted with Windows DPAPI for the same Windows user. The script only accepts the pinned Nexus HTTPS origin; it never listens on local/public ports. It makes an explicit, user-started outbound connection. Qwen remains on localhost:9931.

## Important limits

- No commands are pulled/executed: the server always replies `command:null`.
- No startup registration, Windows privilege elevation, telemetry upload, file read, screenshot or remote shell.
- Do not post screenshots of pairing codes, token exports or credentials.
- Actual Windows pairing, Vercel/Neon storage connectivity and CTRL+C cleanup are **not yet physically verified**.
- If connectivity fails, inspect the server deployment and auth behavior before repeated pairing.
- Next phase: bound screenshot/result transport, fresh-frame fencing, allowlisted user-approved click/type, and shared Workspace MCP tools for both clients.
