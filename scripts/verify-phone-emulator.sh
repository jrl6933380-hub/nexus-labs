#!/usr/bin/env bash
set -euo pipefail
adb install -r android/phone/build/nexus-phone-0.2.apk
adb install -r android/phone/build/nexus-phone-tests.apk
adb shell dpm set-device-owner app.nexus.phone/.NexusAdmin
adb shell settings put secure enabled_accessibility_services app.nexus.phone/.PhoneAccessibility
adb shell settings put secure accessibility_enabled 1
adb shell pm grant app.nexus.phone android.permission.POST_NOTIFICATIONS
adb shell am instrument -w app.nexus.phone.test/app.nexus.phone.PhoneTestRunner > /tmp/nexus-phone-instrumentation.txt
cat /tmp/nexus-phone-instrumentation.txt
grep -q 'PASS native device-owner' /tmp/nexus-phone-instrumentation.txt
! grep -q 'FAIL\|INSTRUMENTATION_FAILED\|Process crashed' /tmp/nexus-phone-instrumentation.txt
mkdir -p test-results/phone
adb pull /sdcard/Android/data/app.nexus.phone/files/nexus-home.jpg test-results/phone/native-home.jpg
