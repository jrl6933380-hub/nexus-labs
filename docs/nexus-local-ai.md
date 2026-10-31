# Nexus Local AI — phase 1 (TCL T607DL)

Status: integration scaffold only, NOT a working Nexus local inference runtime. Do not report an installed model or deployed APK from this PR.

## Actual device evidence
Owner tested Google AI Edge Gallery's Mobile Actions 270M model on the TCL T607DL (3 GB RAM / 32 GB storage) with Wi-Fi disabled and reported flashlight activation. This demonstrates **Gallery's** fine-tuned model plus its native Android action executor works locally; it does not establish an inference API inside Nexus, nor prove all network routes were disabled. Test explicitly with Airplane mode if possible (then turn Wi-Fi off), and repeat inside the future Nexus APK.

## Existing app constraints
- Java Android companion: `android/phone/app/src/main/java/app/nexus/phone` (package `app.nexus.phone`).
- Build: `scripts/build-phone.sh` uses aapt2, javac and d8 directly, with retained APK signing. **No Gradle**, LiteRT dependency or model weights currently bundled.
- Remote control: `BridgeService` polls `/api/phone` when explicitly connected. Keep existing pairing, session, permissions, Shizuku controls, and owner-only enforcement. Never route untrusted model text directly to `DeviceTools.execute` or `PhoneAccessibility.execute`.
- Native APK installed on a managed device must preserve signing key and update path. Do not uninstall or reprovision without a tested recovery plan.

## Architecture / delivery gates
1. **Contract and trust boundary (this PR).** `LocalActionGate` validates a narrow JSON action proposal and rejects arbitrary commands. It intentionally has no executor or model loading. No behavior change to the existing app.
2. **Build-capability spike.** On a disposable cloud build target, evaluate official LiteRT-LM Android dependency packaging and Android 13 ABI for this TCL. Because the current app uses custom aapt2/d8 packaging, either supply pinned AAR/native dependencies with verified checksums, or create an isolated Gradle module for local inference. Do not modify the retained-signature production APK build until a reproducible side-by-side build passes.
3. **Runtime adapter.** Introduce `LocalInferenceEngine` abstraction with `load(modelFile)`, `generate(prompt, toolSchema)`, `unload()` and deterministic error/timeout behavior. Use a documented LiteRT-LM-compatible fine-tuned FunctionGemma Mobile Actions .litertlm package, not the generic base model. Download over HTTPS, check verified model digest, show size and memory warnings, store privately, support cancellation, and never infer install success solely from download completion.
4. **Local action executor.** Map validated actions to Android APIs with explicit permissions and per-action checks. Start with flashlight on/off and open Wi-Fi settings. These should require a user interaction to start an active local session. `show_map` must be explicitly approved before sending location text to another application. Sending email, contacts, calendar edits, shell, force-stop, and remote MCP calls are **out of scope** in phase 1.
5. **UI.** Add owner-only `Local AI` screen from existing Nexus Phone Home: model downloaded/loaded status, RAM/storage warnings, text box, action preview, confirmation where appropriate, latency/memory metrics, unload/delete controls, and a clear offline indicator. Do not claim offline when a cloud fallback was used.
6. **Router.** Future agent layer chooses local or cloud execution by capability and consent. Never silently elevate phone permissions or bypass the remote bridge's authorization.

## First acceptance matrix
- No model installed: UI clearly says unavailable; old remote bridge works.
- Correct local model installed: local flashlight on/off succeeds in Airplane mode with Wi-Fi turned off; test never contacts Nexus server.
- Invalid model output / extra keys / unknown action: rejected without device effect.
- Model OOM, GPU/backend incompatibility, interruption and app backgrounding: error surfaced, no repeated action, no crash loop.
- Phone locked, user disconnects, or app session ends: refuse new execution.
- Offline test: repeat 5 times, log model load time, tokens/second, peak memory and action latency without storing private prompts.
- Existing bridge regression: screenshots, Home, gestures, stop/reconnect, signing upgrade and owner authorization work unchanged.

## Reference implementations
- Google AI Edge Gallery source: https://github.com/google-ai-edge/gallery
- Mobile Actions fine-tuning and action set: https://ai.google.dev/gemma/docs/mobile-actions
- LiteRT-LM Kotlin Android tools and Engine documentation: https://developers.google.com/edge/litert-lm/android
- Mobile Actions model card: https://huggingface.co/litert-community/functiongemma-270m-ft-mobile-actions

Note: the pretrained Mobile Actions task schema includes flashlight, contacts, send email, map, Wi-Fi settings and calendar. The Nexus local contract deliberately exposes fewer actions. If the model yields Google Gallery's function-call envelope, adapt and validate it explicitly rather than assuming raw JSON compatible with `LocalActionGate`.
