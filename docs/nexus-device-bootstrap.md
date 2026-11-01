# Nexus device bootstrap plan

## ROG Ally (Windows 11)

Start with `scripts/ally/bootstrap.ps1`. Check mode is read-only; Install/Repair currently only create a local staging folder and README. **There is not yet a remote control agent or signed installer.** Do not claim that the Ally can be operated remotely until the Windows companion, authenticated server bridge, MCP tools, and physical verification are completed in issue #868.

Run from a trusted checked-out source folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ally\bootstrap.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ally\bootstrap.ps1 -Install
```

These commands do not install third-party binaries, modify Windows startup, open ports, replace Windows, or touch llama.cpp / Qwen files. Review scripts before executing. Never pipe remote web content directly into PowerShell.

Future authenticated install design: download a version-pinned, signed executable from owner-controlled Nexus releases; verify SHA-256/signature before executing, show requested permissions, pair with short-lived owner code, require explicit local Connect, and make Disconnect/Uninstall easy. Run only with current-user permissions. Screen/click/type first; privileged commands and arbitrary shell are out of scope. Reuse phone bridge's session TTL and request fencing, but isolate credentials by device.

## TCL Android / Termux

Termux bootstrap is a separate entry point; it can install user-space dependencies and call Nexus APIs but cannot enable Android accessibility or privileged device controls by itself. Keep the already-installed Nexus Phone app as the authorized Android device bridge; never duplicate its credentials or auto-grant permissions.

## Acceptance before remote control

- Test PowerShell script on actual Ally.
- Complete Windows companion with interactive owner pairing and authenticated outbound polling.
- Add server bridge and owner-scoped MCP commands for ChatGPT and Claude.
- Verify on-device screenshots, click, type, stale frames, revocation, and connection loss.
- Protect local AI at 127.0.0.1:9931; do not expose port publicly.
