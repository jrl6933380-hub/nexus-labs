# Ally bridge — local probe and next protocol slice

This PR adds **local** Windows capability checks, not remote device access. Never report ChatGPT or Claude as having control until server pairing and MCP tools work on the physical Ally.

Run in an interactive Windows PowerShell session from a trusted local checkout:

```powershell
powershell -NoProfile -File .\scripts\ally\local-probe.ps1 -Action status
powershell -NoProfile -File .\scripts\ally\local-probe.ps1 -Action screen
```

The status probes only loopback `127.0.0.1:9931/health` (Qwen), and doesn't send any data. The screen probe saves a private PNG into the current user's TEMP folder and returns its path. Screenshot may contain secrets. Do not upload, sync, or commit screenshots.

## Next security-sensitive PRs

1. Server-side `lib/allyBridge.js` with independent owner-scoped credentials, pairing code TTL, nonce/CAS race protection, one-shot command receipts, screen freshness, command expiry, and revocation. Do not reuse phone tokens.
2. `api/ally.js` with owner-authenticated pair-code/status/revoke and token-authenticated start/poll/complete/disconnect; outbound HTTPS client only, never inbound RDP/SMB/public llama.cpp.
3. Windows user-session companion: local Connect/Disconnect and visible indicator; poll with bearer credential stored using Windows DPAPI; user-space screenshot and allowlisted visible click/type only. Refuse locked desktop and secure/UAC/password surfaces. Avoid unrestricted shell or privilege elevation.
4. Register `read_nexus_ally_status`, `control_nexus_ally`, `read_nexus_ally_result`, `disconnect_nexus_ally` through existing workspace MCP owner checks. User approves any side effect outside a test app.
5. Install with checksummed or signed release from owner-controlled origin; test on actual ROG Ally before enabling external actions.

Issue #868 tracks full implementation. This PR only establishes Windows API availability and Qwen loopback checks.
