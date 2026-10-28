#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-/tmp/android-sdk}"
BT="$SDK/build-tools/35.0.0"
OUT="$ROOT/android/phone/build"
JAR="$SDK/platforms/android-35/android.jar"
mkdir -p "$OUT/test-classes" "$OUT/test-dex"
cat > "$OUT/test-manifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.nexus.phone.test"><uses-sdk android:minSdkVersion="30" android:targetSdkVersion="35"/><application android:label="Nexus instrumentation"/><instrumentation android:name="app.nexus.phone.PhoneTestRunner" android:targetPackage="app.nexus.phone"/></manifest>
XML
"$BT/aapt2" link -o "$OUT/test-base.apk" --manifest "$OUT/test-manifest.xml" -I "$JAR"
javac -source 8 -target 8 -encoding UTF-8 -classpath "$JAR:$OUT/classes.jar:$OUT/deps/api.jar" -d "$OUT/test-classes" "$ROOT/android/phone/test-app/PhoneTestRunner.java"
jar cf "$OUT/test.jar" -C "$OUT/test-classes" .
"$BT/d8" --lib "$JAR" --classpath "$OUT/classes.jar" --min-api 30 --output "$OUT/test-dex" "$OUT/test.jar"
cp "$OUT/test-base.apk" "$OUT/test-unsigned.apk"
(cd "$OUT/test-dex" && jar uf "$OUT/test-unsigned.apk" classes.dex)
"$BT/zipalign" -f 4 "$OUT/test-unsigned.apk" "$OUT/test-aligned.apk"
"$BT/apksigner" sign --ks "${NEXUS_PHONE_KEYSTORE:-$OUT/playground.keystore}" --ks-key-alias nexus-phone --ks-pass env:NEXUS_PHONE_KEY_PASSWORD --key-pass env:NEXUS_PHONE_KEY_PASSWORD --out "$OUT/nexus-phone-tests.apk" "$OUT/test-aligned.apk"

cat > "$OUT/disposable-manifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.nexusplaygroundtest"><uses-sdk android:minSdkVersion="30"/><application android:label="Disposable Nexus test app" android:hasCode="false"><activity android:name="android.app.Activity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>
XML
"$BT/aapt2" link -o "$OUT/disposable-base.apk" --manifest "$OUT/disposable-manifest.xml" -I "$JAR"
"$BT/zipalign" -f 4 "$OUT/disposable-base.apk" "$OUT/disposable-aligned.apk"
"$BT/apksigner" sign --ks "${NEXUS_PHONE_KEYSTORE:-$OUT/playground.keystore}" --ks-key-alias nexus-phone --ks-pass env:NEXUS_PHONE_KEY_PASSWORD --key-pass env:NEXUS_PHONE_KEY_PASSWORD --out "$OUT/disposable-test.apk" "$OUT/disposable-aligned.apk"
