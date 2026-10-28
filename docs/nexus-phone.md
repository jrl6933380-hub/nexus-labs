# Nexus Phone prototype

Owner-only remote Android tools, backed by the existing Nexus store and workspace MCP connection. Android companion package: `app.nexus.phone`, version 0.1.0, Android 11+, target 35. No root, Shizuku, model provider, microphone or camera permission. The first device target is Justin's TCL ION V T607DL, Android 13 UHBB, 3 GB RAM.

## Flow

1. Open `/phone.html` as the Nexus owner; create a five-minute, 72-bit single-use code.
2. Install the APK on the phone and enter the code. The device receives a random 256-bit credential, encrypted locally with Android Keystore. Only its SHA-256 digest is stored server-side. No credentials in URLs or logs.
3. Manually enable accessibility; manually tap Connect. The foreground notification exposes Disconnect. No boot receiver or unattended auto-start.
4. The phone calls the fixed HTTPS `/api/phone` origin every two seconds while connected. It opens no public inbound port. Network errors stop control; reconnect is manual.
5. `read_nexus_phone_status`, `control_nexus_phone`, `read_nexus_phone_result`, `disconnect_nexus_phone` reuse workspace OAuth and explicitly require owner identity. The existing connector must refresh its tool list after deployment.
6. Queue a screen command, read the result until done, inspect the actual image, then use its fresh `frame_id` and normalized coordinates for tap/swipe/type. Each action returns a receipt rather than pretending it succeeded synchronously. Request a fresh screen to verify the visible outcome.

## Boundaries

One paired phone and one in-flight command per owner. Expiring commands are atomically claimed at most once and never replayed after uncertain network outcomes. Pairing, command delivery and state updates use store transactions/CAS. Pairing replaces the old credential. Local and remote stop invalidate session-bound results. Device polling cannot restart a stopped session. Screenshots expire after 120 seconds; command inputs disappear on delivery. Sixteen result IDs are retained to fence duplicate completion; no screenshot history. The status endpoint never returns credentials, typed text, screenshots or pairing codes.

Tap, swipe and type require a screenshot no older than 30 seconds. Android also checks display dimensions and lock state before execution. Text replaces a focused, editable, non-password field; this is not a general keyboard or clipboard tunnel. Protected windows may refuse screenshots. No unrestricted shell, accessibility hierarchy export, install/uninstall, PIN bypass, password collection or automatic posting. Agents treat all screen content as untrusted data and still need specific authority for external side effects.

The service polls only during a visible user-started session. Closing ChatGPT does not end that session; Disconnect does. Android battery management may stop it. A busy phone may delay gestures. A delivered/expired action can have an uncertain outcome: inspect a new screen, never replay a purchase/send blindly. This bridge is transport, not a continuously running AI.

## Build

Install JDK 17 and Android SDK command-line tools; accept SDK licenses and install `platforms;android-35` and `build-tools;35.0.0`. Run `ANDROID_HOME=/path/to/sdk bash scripts/build-phone.sh`. This uses Android's aapt2/d8/apksigner directly, without Gradle or third-party Android dependencies. Output: `android/phone/build/nexus-phone-0.1.apk`.

The ignored `android/phone/build/development.keystore` signs development builds. Retain it privately if you need in-place updates. A lost/replaced key means uninstalling the prototype before installing another build. Production release signing and distribution are separate work. Never commit a keystore or token. Put the tested APK in `public/downloads/nexus-phone-0.1.apk` for the owner download page. Source changes require rebuilding that binary.

## Deployment / acceptance

Deploy the PR using Nexus's existing review process. This change adds one API endpoint, a private owner pairing surface and four tools; it does not change the plugin identity. No phone is connected until the owner installs, pairs and explicitly connects it. On the TCL verify install → restricted-settings approval → accessibility enable → pair → connect → status → screen → Home → screen → open browser → screen → tap → type → screen → swipe → Disconnect. Verify remote stop, locked screen refusal, rotation refusal, network loss and reboot. Actual TCL execution cannot be certified from a cloud build or fixture tests.

## Verification recorded for v0.1

- 42/42 focused Node tests passed in both the local workspace and an independent Linux build environment: new phone bridge lifecycle/security tests plus existing workspace, OAuth, board-resource and live-browser API tests.
- Pairing/delivery races execute the application's actual Lua interpreter against an in-memory command transport; tests are not production database or phone trials.
- Java compiled against Android SDK 35; D8 produced the DEX; aapt2 linked the manifest/resources; zipalign and apksigner completed. APK Signature Scheme v3 verifies. Package `app.nexus.phone`, min SDK 30, target SDK 35, version 0.1.0.
- APK SHA-256: `a940b0fc94d6379593a83026d202d009c3561284018ac996e35712f46894a30b` (25,054 bytes).
- JavaScript/shell syntax and `git diff --check` passed.
- Browser fixture `scripts/verify-phone-bridge.mjs` was prepared but did not complete: Chromium crashed or stalled in a 473 MB sandbox, including a bounded low-memory retry. No browser layout/accessibility success is claimed.
- No physical TCL install, native UI run, gesture/screenshot round-trip, live owner pairing or production deployment has been performed. Those are the next acceptance steps after approved deployment.

## v0.2 — main-app access and visible pairing field

The owner now opens **Nexus Home → Phone** (also listed in More) for status, install/update, single-use pairing-code creation/copy, the Android app-opening shortcut and Disconnect. `/workspace.html?view=phone` opens the same in-shell view. Customers do not receive the tile or controls; the existing owner-only API still enforces access. The standalone setup page links back to this main-app view and shows an owner sign-in link through the integrated view.

The v0.2 APK moves a visibly labeled, shaded Pairing code field near the top. It accepts the `nexusphone://connect` browsable intent only to open its activity; it does not accept pairing tokens or start a session from a URL. The Chrome intent link names the exact package and has a setup-page fallback. Download/update v0.2 before using Open phone app. There is a return shortcut to the main Nexus Phone view inside the native app.

Build output is now `android/phone/build/nexus-phone-0.2.apk`, published at `/downloads/nexus-phone-0.2.apk`. Version code 2/version name 0.2.0. The v0.1 APK remains available. Its development signing key was reused, and both APK certificate SHA-256 digests match: `554a80eebe5fbccb345ac90ba6e185c43e5f0c916ba2161853dd75b8cc8c1ae2`. APK v0.2 SHA-256: `4385ba3bdf8eee3e6222236ec483e08235a6ce75be890e1e30da55c5da45f795`.

Validation: 18 focused Node checks passed across phone navigation, phone bridge and existing navigation scope. DOM checks exercise owner code creation/copy, app link, sign-in recovery and customer exclusion. Java/DEX/resource compilation, APK signature verification, JS/shell syntax and diff checks passed. Actual TCL update installation, app-opening intent and native field visibility still require device acceptance; no device test is claimed.
