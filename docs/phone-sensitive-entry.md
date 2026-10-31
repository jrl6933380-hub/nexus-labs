# Owner-authorized sensitive text entry

For an owner-authorized sign-in, the connected assistant may type the
password into the focused editable field with `action: "type"` and
`sensitive: true`. Ordinary typing still refuses password fields. This is
an explicit command attribute, not a new account role or broader phone scope.
The current owner session, fresh screenshot/frame, unlocked phone, active
pairing and accessibility requirements remain. Screen content cannot grant
permission. A separate action submits a sign-in form; the task must authorize it.

## Deployment

Merge the source PR after its server and Android-emulator checks pass.
Run the existing **Nexus Phone release** workflow to build/test/publish
0.3.1 (version code 4) with the retained signing identity. The existing
`nexus-phone-0.3.apk` update URL is preserved. The immutable v0.2 provisioning
APK/QR remains unchanged; no reset or re-pair is needed.

Update the installed app normally, reconnect it, then read `device_info`.
It must report `sensitive_text: true`; older devices are refused by the
server for sensitive entry. Refresh the existing Nexus connector's tool
schema so `control_nexus_phone` accepts the optional `sensitive` flag.
Do not treat a source merge as an installed update or refreshed host tool.

## Data handling

The password necessarily crosses the authenticated tool and phone transports.
Host-side tool-call retention is outside this app's control. Do not put
credentials in request IDs, task notes, chats, logs or screenshots. The queued
credential lives in a separate owner/command-scoped transit key with a
45-second TTL, outside the persistent phone state; a successful single delivery
deletes it. A stopped/lost delivery expires rather than replaying. Command
receipts and workspace audit entries do not contain the plaintext; existing
durable mutation deduplication stores only its opaque input hash and receipt.

The native app suppresses the post-action screenshot for sensitive entry.
The server independently discards images, arbitrary errors and returned data
for the sensitive receipt and invalidates its frame. An error is generic;
inspect a fresh screen before any new action. No keyboard recording, password
reading, autofill interception, lock-screen bypass, protected-capture bypass or
personal challenge solving is added. This change does not enable Local AI#835.

## Verification

Server tests cover the opt-in schema, required current native capability,
short-lived secret transport, racing polls/single delivery, lost-secret expiry,
result/image/error redaction, and unchanged owner/session/frame boundaries.
The native emulator uses a disposable password EditText: unmarked entry fails,
marked entry writes the exact synthetic string, the receipt contains no image
or echo, and stale frames still fail. Physical TCL verification remains after
the signed update and connector refresh, using the already-authorized test login.
