#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/phone
collect_diagnostics() {
  adb logcat -d > test-results/phone/native-logcat.txt 2>&1 || true
  adb shell dumpsys accessibility > test-results/phone/accessibility-state.txt 2>&1 || true
  adb shell dumpsys activity services app.nexus.phone > test-results/phone/phone-services.txt 2>&1 || true
  for report in /tmp/nexus-phone-instrumentation.txt /tmp/nexus-shizuku-instrumentation.txt /tmp/nexus-assistants.txt; do
    if [ -f "$report" ]; then cp "$report" test-results/phone/; fi
  done
}
trap collect_diagnostics EXIT
adb install -r public/downloads/nexus-phone-0.2.apk
adb shell dpm set-device-owner app.nexus.phone/.NexusAdmin
# Upgrade the managed v0.2 installation in place; instrumentation below must still see device owner.
adb install -r android/phone/build/nexus-phone-0.3.apk
adb install -r android/phone/build/nexus-phone-tests.apk
adb install -r android/phone/build/disposable-test.apk
# Do not pre-bind the service: am instrument force-stops the target process.
# The runner enables it only after instrumentation owns the process.
adb shell settings put secure accessibility_enabled 0
adb shell settings delete secure enabled_accessibility_services
adb shell pm grant app.nexus.phone android.permission.POST_NOTIFICATIONS
timeout 120s adb shell am instrument -w app.nexus.phone.test/app.nexus.phone.PhoneTestRunner > /tmp/nexus-phone-instrumentation.txt
cat /tmp/nexus-phone-instrumentation.txt
grep -q 'PASS native device-owner' /tmp/nexus-phone-instrumentation.txt
! grep -q 'FAIL\|INSTRUMENTATION_FAILED\|Process crashed' /tmp/nexus-phone-instrumentation.txt
mkdir -p test-results/phone
adb pull /sdcard/Android/data/app.nexus.phone/files/nexus-home.jpg test-results/phone/native-home.jpg
# Exercise the actual official Shizuku shell backend on this disposable emulator.
curl -fLsS https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk -o /tmp/nexus-shizuku.apk
printf '%s  %s\n' 6e273ab0e991c4e79bc8b1bbb9b9dd739ccac1a8712a541a214078886b7b790f /tmp/nexus-shizuku.apk | sha256sum -c -
adb install -r /tmp/nexus-shizuku.apk
unzip -p /tmp/nexus-shizuku.apk lib/x86_64/libshizuku.so > /tmp/nexus-shizuku-starter
adb push /tmp/nexus-shizuku-starter /data/local/tmp/nexus-shizuku-starter
adb shell chmod 755 /data/local/tmp/nexus-shizuku-starter
shizuku_apk="$(adb shell pm path moe.shizuku.privileged.api | tr -d '\r' | sed 's/^package://')"
adb shell /data/local/tmp/nexus-shizuku-starter "--apk=$shizuku_apk"
# A disposable downloaded app provides a harmless force-stop target.
adb shell am start -n com.example.nexusplaygroundtest/android.app.Activity
timeout 120s adb shell am instrument -w -e shizuku true app.nexus.phone.test/app.nexus.phone.PhoneTestRunner > /tmp/nexus-shizuku-instrumentation.txt
cat /tmp/nexus-shizuku-instrumentation.txt
grep -q 'PASS actual Shizuku' /tmp/nexus-shizuku-instrumentation.txt
! grep -q 'FAIL\|INSTRUMENTATION_FAILED\|Process crashed' /tmp/nexus-shizuku-instrumentation.txt
adb shell dumpsys package com.example.nexusplaygroundtest | grep -q 'stopped=true'

adb shell dpm set-device-owner app.nexus.phone/.NexusAdmin
# Disposable package-name fixtures exercise native launch routing, never real assistant accounts.
adb install android/phone/build/com.anthropic.claude.apk
adb install android/phone/build/com.openai.chatgpt.apk
adb install android/phone/build/com.example.nexusbrowser.apk
timeout 120s adb shell am instrument -w -e assistants true app.nexus.phone.test/app.nexus.phone.PhoneTestRunner > /tmp/nexus-assistants.txt
cat /tmp/nexus-assistants.txt
grep -q 'PASS assistant installed-package' /tmp/nexus-assistants.txt
! grep -q 'FAIL\|INSTRUMENTATION_FAILED\|Process crashed' /tmp/nexus-assistants.txt
