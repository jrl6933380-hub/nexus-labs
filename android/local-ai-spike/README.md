# Nexus Local AI Lab (isolated proof of concept)

A separate disposable Android package, **NOT** the installed production Nexus Phone companion. This project has no INTERNET permission, remote phone control, Shizuku, accessibility, or background service. It only imports a user-selected `.litertlm` file into app-private storage and attempts one local inference.

## Build
Requires Android SDK 35, JDK 17, Gradle 8.11+ and access to Google Maven. From this folder:
```sh
gradle :app:assembleDebug
```
Debug APK: `app/build/outputs/apk/debug/app-debug.apk`. This has not yet been compiled or tested on the TCL. Do NOT try to install it as an update to `app.nexus.phone`: it is a separate application ID.

## Manual test
1. Install this debug APK on the TCL; do not uninstall Nexus Phone.
2. Acquire a license-compliant fine-tuned FunctionGemma 270M MobileActions LiteRT-LM model file (not base weights).
3. Import with Android document picker. The app copies its own private model file, so ensure **at least twice the model's size** is free during import.
4. Switch to Airplane mode and disable Wi-Fi, then run a short prompt.
5. Record load time, result, crashes and memory in Android developer settings.
6. The model's tool-call formatting may differ from raw JSON; this lab intentionally does **not** execute calls. Never trust model output as an Android command.

## Limits
The app attempts a full model reload for every inference and caps imported files at 1.5 GB to reduce OOM risk on the TCL. This is a compatibility spike, not the final model manager. Success is not guaranteed; CPU/GPU fallback depends on model packaging and the hardware.

Once proven on a physical TCL, migrate a tested LiteRT adapter into Nexus Phone with retained signing and gated, explicit device actions. Before shipping, pin all Gradle dependencies, generate a verification report, and add model-source/hash checks.
