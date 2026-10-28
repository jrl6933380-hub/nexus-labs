# Nexus Phone playground v0.2

Justin's TCL ION V T607DL (Android 13 UHBB, 3 GB RAM) is the intended dedicated test device. This is a custom Android home and management app; Android remains the OS. No firmware flashing, root, bootloader unlock, remote wipe or unrestricted shell is implemented.

## What is implemented

- Native black/gold Nexus Home: live connection state, Connect/Disconnect, Nexus, Ad Studio, Agent Board, launchable apps, pairing, capability setup and recovery.
- Android Home role for an ordinary installation; device-owner persistent preferred Home after provisioning.
- Device-admin receiver, Android 12+ provisioning-mode and policy-compliance activities, public APK with a checksum-pinned QR payload.
- Existing owner-scoped pairing, Keystore credential, visible foreground control session, stale/rotation/lock protections and at-most-once command delivery remain in place.
- UI actions return a fresh screenshot when possible. An action's success is independent of screenshot success; `ok:true, screen_error` means observe again, do not repeat the action.
- New commands in the existing `control_nexus_phone` schema: `device_info`, `list_apps`, `open_nexus` (home/ads/board/phone), `recents`, `notifications`, `brightness` (5–255), `stay_awake` (while charging) and `force_stop` (downloaded apps only).
- Shizuku API 13.1.5 is bundled from official, SHA-256-pinned Maven artifacts. The separate Shizuku manager app must be installed and started on the phone. API v13+ is required. A bounded user service exposes brightness and force-stop through fixed argument arrays, with no shell interpreter or arbitrary command input. Its Binder checks the caller's app UID. The client also refuses system apps, the current home app, Nexus and Shizuku for force-stop.
- Deeper controls require a local switch. Brightness/force-stop also require Shizuku permission; stay-awake requires device-owner provisioning. Device-owner status and Shizuku status are separate capabilities.
- Shizuku on a non-root phone needs restarting after reboot. The remote session still needs manual Connect. Home can start as Android's launcher; it does not silently start remote control.

## Prepare before resetting

1. Merge/deploy the reviewed phone PR and confirm the public APK and provisioning payload are the exact verified bytes. Do not reset merely because a build succeeds.
2. Back up anything Justin wants from the TCL. Confirm he can complete Android's Google-account/device-protection verification. Handle account credentials on the phone; never collect them through Nexus.
3. Open `/phone.html` on another screen and expand **Dedicated phone · reset and provision**. The QR contains only a download URL, component and SHA-256 checksum; it is not an account enrollment token.
4. Reset through Android Settings when Justin is physically ready. The current remote app, pairing and connection will be erased. An agent cannot operate the initial setup through that erased connection.
5. At Android's welcome screen, tap the same blank area six times for QR provisioning; connect Wi-Fi and scan the displayed QR. Availability depends on this TCL's setup wizard/firmware and has to be verified physically. Stop if unavailable; do not try account/lock bypasses.
6. Android should install Nexus Phone, establish its device owner and show **Finish setup**. Open Nexus Phone and choose **Set Nexus as Home**. No kiosk restrictions, Settings lockout or forced app hiding are applied.
7. Open the Nexus owner page, create a fresh pairing code, pair the app, enable accessibility/restricted-settings approval if required, and tap Connect.
8. Install Shizuku from https://shizuku.rikka.app/download/. Start through wireless debugging and its on-device pairing flow, then **Authorize Nexus in Shizuku** and enable **deeper tools** in Nexus Home.
9. Start a fresh ChatGPT/Claude connection session to load the new tool schema. Read status, then request `device_info` and verify version/owner/Shizuku before using deeper controls.

### USB provisioning fallback (physical computer required)

After a reset, complete only the minimum Android setup **without adding accounts**. Enable developer options and USB debugging, connect a computer and approve that computer on the phone. Use official Android platform-tools:

```bash
adb devices
adb install nexus-phone-0.2.apk
adb shell dpm set-device-owner app.nexus.phone/.NexusAdmin
```

Run the owner command only on the intended clean playground device. Android can refuse if accounts, profiles, existing management or OEM restrictions exist. Inspect the actual error rather than repeatedly resetting. Then open Nexus Phone, make it Home, pair and connect. Developer/test provisioning guidance: https://developer.android.com/work/dpc/dedicated-devices/cookbook .

## Recovery

- Disconnect in Nexus Home or its persistent notification; remote stop from the owner page also ends the session.
- **Android Settings** always remains in Nexus Home.
- **Release Nexus Home** clears the device-owner preferred Home and opens Android's Home settings.
- **Forget phone pairing** stops control, removes the local credential and disables deeper tools. Revoke on the Nexus owner page too.
- **Release device management** is a local, confirmation-protected action. It stops control, clears the preferred Home and calls Android's device-owner release API, without requesting a wipe. Android may refuse; the UI shows the error. Re-provisioning may require another clean setup.
- No remote tool exposes reset, management release, app uninstallation, account changes or arbitrary shell.

## Signing and reproducible package preparation

The v0.2 signing identity differs from the disposable v0.1 key. Install v0.2 after the planned reset, or uninstall v0.1 first and re-pair. Do not attempt an in-place update with mismatched signatures.

The persistent key and random password were stored as encrypted repository Actions secrets: `NEXUS_PHONE_PLAYGROUND_KEYSTORE_B64` and `NEXUS_PHONE_PLAYGROUND_KEY_PASSWORD`. No private signing material belongs in git, logs, test artifacts or a board message. Restore only inside a trusted build and remove the local keystore afterward. The build fails if signing identity/password are absent; it never silently generates a new key.

JDK 17, Android SDK 35/build-tools 35.0.0, curl, unzip and Python 3 are needed. The build uses aapt2/javac/d8/apksigner, without Gradle. Shizuku's MIT license is included in the APK and `docs/licenses/shizuku-api.txt`. ZIP entry timestamps/order are normalized.

```bash
bash scripts/build-phone.sh
cp android/phone/build/nexus-phone-0.2.apk public/downloads/nexus-phone-0.2.apk
node scripts/prepare-phone-provisioning.mjs
```

After changing the APK, regenerate the provisioning PNG from the exact JSON (Python `qrcode`, error correction M, border 4). Verify that a decoder returns the exact payload. Never update the JSON without the PNG and published APK. The Node provisioning test checks the APK hash and download metadata.

## Verification and acceptance

`.github/workflows/nexus-phone.yml` runs bridge/provisioning/connector tests and setup-page browser checks. A separate job compiles and signs the app plus an instrumentation-only test APK, then uses an Android 13 emulator to test device-owner setup, preferred Home, capabilities, app discovery, the deeper-tools gate, managed stay-awake, truthful missing-Shizuku errors, Home's automatic screenshot, stale frames, session stop and local management release.

The emulator test APK is not in the release. Native screenshots are uploaded as CI evidence. The cloud sandbox cannot substitute for physical TCL testing. Shizuku's real service startup, authorization and privileged operations require a separately recorded device test; compile success does not prove them.

Physical acceptance after provisioning: verify QR download/installation and device owner, Nexus Home after pressing Home and reboot, fresh pairing, screenshot/tap/swipe/text, direct Nexus views, notifications/recents, app discovery, Shizuku startup/permission, requested brightness with adaptive brightness accounted for, stay-awake while charging, force-stop of one disposable downloaded test app, screenshot-failure semantics, Disconnect, network loss and all local recovery controls. Record actual results, not assumptions. Keep sending/posting/buying/deleting/account changes under their existing specific authorization boundaries.

Design: retain Nexus black/gold, a left-aligned identity, one live state block, large stacked touch targets, workspace shortcuts above setup, and clearly reachable recovery. No fake usage or readiness indicators.
