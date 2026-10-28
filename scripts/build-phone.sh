#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/tmp/android-sdk}}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
SRC="$ROOT/android/phone/app/src/main"
OUT="$ROOT/android/phone/build"
rm -rf "$OUT/classes" "$OUT/dex" "$OUT/generated"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/deps"
# Pinned official Shizuku API dependencies, MIT licensed. No Gradle dependency resolution.
for module in api provider aidl shared; do
 aar="$OUT/deps/$module.aar"
 if [ ! -f "$aar" ]; then curl -fLsS "https://repo.maven.apache.org/maven2/dev/rikka/shizuku/$module/13.1.5/$module-13.1.5.aar" -o "$aar"; fi
 case "$module" in
 api) expected=4def9bde498ef8626614c2fc5db9af4749c86f16f6c33e3f5658d35e70bab59b ;;
 provider) expected=b0f18cd9812464ec171c53cac93a819fe411718a3965c311f01eb4de265381b3 ;;
 aidl) expected=33fe7191cdd69fcb66d649264f3b0c47acb2f3d6343afc05b98dbbff6f221963 ;;
 shared) expected=4659642c9339be0a26e9c65bb8648f7ad6d8f4a465f557993ccbc78802381635 ;;
 esac
 printf '%s  %s\n' "$expected" "$aar" | sha256sum -c -
 unzip -p "$aar" classes.jar > "$OUT/deps/$module.jar"
done
CP="$JAR:$OUT/deps/api.jar:$OUT/deps/provider.jar:$OUT/deps/aidl.jar:$OUT/deps/shared.jar"
"$BT/aapt2" compile --dir "$SRC/res" -o "$OUT/resources.zip"
"$BT/aapt2" link -o "$OUT/base.apk" --manifest "$SRC/AndroidManifest.xml" -I "$JAR" --java "$OUT/generated" --version-code 3 --version-name 0.3.0 "$OUT/resources.zip"
find "$SRC/java" "$OUT/generated" -name '*.java' > "$OUT/sources.txt"
javac -source 8 -target 8 -encoding UTF-8 -classpath "$CP" -d "$OUT/classes" @"$OUT/sources.txt"
jar cf "$OUT/classes.jar" -C "$OUT/classes" .
"$BT/d8" --lib "$JAR" --min-api 30 --output "$OUT/dex" "$OUT/classes.jar" "$OUT/deps/api.jar" "$OUT/deps/provider.jar" "$OUT/deps/aidl.jar" "$OUT/deps/shared.jar"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
mkdir -p "$OUT/licenses/assets"
cp "$ROOT/docs/licenses/shizuku-api.txt" "$OUT/licenses/assets/SHIZUKU-LICENSE.txt"
(cd "$OUT/licenses" && jar uf "$OUT/unsigned.apk" assets/SHIZUKU-LICENSE.txt)
(cd "$OUT/dex" && jar uf "$OUT/unsigned.apk" classes*.dex)
# Normalize ZIP entry timestamps/order so the same inputs produce the same unsigned APK.
python3 - "$OUT/unsigned.apk" "$OUT/normalized.apk" <<'PYZIP'
import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as source,zipfile.ZipFile(sys.argv[2],'w') as target:
 for entry in sorted(source.infolist(),key=lambda e:e.filename):
  item=zipfile.ZipInfo(entry.filename,(2026,10,28,0,0,0));item.compress_type=entry.compress_type;item.external_attr=entry.external_attr
  target.writestr(item,source.read(entry.filename))
PYZIP
"$BT/zipalign" -f 4 "$OUT/normalized.apk" "$OUT/aligned.apk"
# A persistent signing key is required for managed-device updates. CI restores it from encrypted secrets.
# Local development builds can opt into a disposable key, but must never be provisioned as device owner.
SIGNING_KEY="${NEXUS_PHONE_KEYSTORE:-$OUT/playground.keystore}"
if [ ! -f "$SIGNING_KEY" ] || [ -z "${NEXUS_PHONE_KEY_PASSWORD:-}" ]; then
 echo "Set NEXUS_PHONE_KEYSTORE and NEXUS_PHONE_KEY_PASSWORD using the retained signing identity." >&2
 exit 1
fi
"$BT/apksigner" sign --ks "$SIGNING_KEY" --ks-key-alias nexus-phone --ks-pass env:NEXUS_PHONE_KEY_PASSWORD --key-pass env:NEXUS_PHONE_KEY_PASSWORD --out "$OUT/nexus-phone-0.3.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT/nexus-phone-0.3.apk"
sha256sum "$OUT/nexus-phone-0.3.apk"
