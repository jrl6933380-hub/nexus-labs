# Cleanup release checklist — 2026-10-31

This is an evidence checklist, not a declaration that launch is complete.
On-device AI (#835) remains deferred until cleanup is accepted. Never
install a local-AI phone build as part of this checklist.

## Current evidence

Baseline: main `1e08f8d823bd3b6f08cfdfc8186d1d5d8f3841f3` (#854).
Production deployment `dpl_8Wgb9bjaa5fP65sBcrobGBunJhao` reported READY.
Read-only production HTTP checks on 2026-10-31 UTC passed for workspace,
customer Forge, all seven mapped Forge screens, Agent Board, Ads, Image
Board, Story Studio, Phone and Waitlist (14 pages, HTTP 200). All eight
legacy edge routes returned HTTP 308 with their exact configured destination.
These responses prove reachability and routing, not signed-in operation.

The live browser redirected workspace Home to owner sign-in with a return URL.
No signed-in owner interaction was verified in that session. The paired TCL
T607DL reported inactive, so no physical-phone gesture test was performed.
The earlier native accessibility fix is tracked in #851 and its successful
run 41170716489; an emulator pass is not physical-phone evidence.

## Repeatable automated checks

Use a Node release supported by Vite (Node 22.12+), then `npm ci` and
`npx playwright install --with-deps chromium`.

```sh
node scripts/audit-surfaces.mjs /tmp/nexus-surfaces.json
node scripts/audit-route-dependencies.mjs /tmp/nexus-route-dependencies.json
node --test test/legacy-route-contract.test.mjs test/legacy-browser-fallback.test.mjs test/legacy-route.test.mjs tests/nexus-space-anchors.test.mjs test/nexus-owner-boundaries.test.mjs test/conference-workshop.test.mjs
npx playwright test e2e/legacy-retirement.spec.mjs e2e/forge-navigation.spec.mjs e2e/owner-home-navigation.spec.mjs
```

Review generated unresolved dependencies individually; dynamic proxies are
not automatically broken. In this audit, /api/push-deliver and
/api/alerts?sweep=1 resolve through exact Vercel rewrites to /api/board;
retain both cron entries. Confirm required PR-head CI and preview deployment
before presenting the change. Fixture-backed browser checks do not establish
production credentials, live data or phone health.

## Remaining signed-in and physical checks

Use the owner's normal sign-in; never bypass auth with an agent bearer or
reset a password just to finish a test. Reconnect the installed phone normally;
no reinstall, pairing reset or device-owner change is needed for web cleanup.

- Home: open Forge Ops, Templates, Agent Board, Ad Maker, Image Board,
  Story Studio, Phone and Lab; return to Home without a nested/stranded shell.
- Forge: switch Ops/Field/Templates, reload a selected tab, open Admin and
  return to Ops. Review caller/account paths using the intended signed-in
  role; preserve worker access and checkout/onboarding callback URLs.
- Customer boundary: use an existing authorized customer session to check its
  Home/builder and absence of owner controls. Do not create accounts or alter roles.
- Read-only launch smoke: reopen existing projects, Life/calendar/reminders,
  waitlist/preview, ads and board. Do not send Nex messages, create reminders,
  run actors/models, trigger dispatch/crons, publish or charge Stripe.
- OAuth/MCP and Phone: record authenticated connector read/status evidence;
  on the connected TCL, confirm current screen, Home/Forge navigation and
  accessibility feedback. Do not alter phone settings or install an APK.

Record environment, commit/deployment, account role, route, expected/actual
result and evidence for each check. A sign-in wall or disconnected device
is an unverified gate, never a passing check.

## Legacy review decisions

Memory/Canvas markup can retire with URL compatibility intact. Mission
Control and Conference Room remain because owner-auth/workshop/pinned-visual
consumers still need a separate migration. See legacy-page-retirement-gate.md.
Keeping these intentional compatibility dependencies is a documented decision,
not permission to delete their APIs or shared assets later.

## Rollback

For this Memory/Canvas batch, revert its merge commit in a new branch/PR,
restore the two original HTML bodies, and revert its dedicated test/workflow
changes together. The eight edge rules and legacy-route.js are unchanged.
There are no schema, secrets, account, billing or APK changes to roll back.
Use the normal approved merge path, then verify the new production deployment
matches the revert commit and is READY. Rerun the route and browser checks.
Do not roll back unrelated newer commits or merge #835 as a recovery step.
