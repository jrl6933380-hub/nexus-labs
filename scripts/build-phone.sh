#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/tmp/android-sdk}}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
SRC="$ROOT/android/phone/app/src/main"
OUT="$ROOT/android/phone/build"
mkdir -p "$OUT/classes" "$OUT/dex"
"$BT/aapt2" compile --dir "$SRC/res" -o "$OUT/resources.zip"
"$BT/aapt2" link -o "$OUT/base.apk" --manifest "$SRC/AndroidManifest.xml" -I "$JAR" --java "$OUT/generated" --version-code 2 --version-name 0.2.0 "$OUT/resources.zip"
find "$SRC/java" "$OUT/generated" -name '*.java' > "$OUT/sources.txt"
javac -source 8 -target 8 -encoding UTF-8 -classpath "$JAR" -d "$OUT/classes" @"$OUT/sources.txt"
jar cf "$OUT/classes.jar" -C "$OUT/classes" .
"$BT/d8" --lib "$JAR" --min-api 30 --output "$OUT/dex" "$OUT/classes.jar"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && jar uf "$OUT/unsigned.apk" classes*.dex)
"$BT/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
# Development signing only. Retain this ignored key for compatible prototype updates.
if [ ! -f "$OUT/development.keystore" ]; then
 keytool -genkeypair -keystore "$OUT/development.keystore" -storepass android -keypass android -alias nexus-development -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=Nexus Phone Development' >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$OUT/development.keystore" --ks-key-alias nexus-development --ks-pass pass:android --key-pass pass:android --out "$OUT/nexus-phone-0.2.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT/nexus-phone-0.2.apk"
sha256sum "$OUT/nexus-phone-0.2.apk"
