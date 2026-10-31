# Forge navigation map — 2026-10-30

Source audit of the current Forge entrypoints. These pages have different audiences and responsibilities; no duplicate screen has yet been proven safe to delete.

| Route | Responsibility | Decision |
| --- | --- | --- |
| /forge.html | Customer builder and project shell, using room auth | Preserve customer entrypoint |
| /forge-hub.html | Owner hub with Ops, Field and Templates tabs | Canonical owner Forge hub |
| /forge-dashboard.html | Sales metrics, lead import and operator controls | Preserve as Ops panel |
| /forge-admin.html | Create worker accounts or grant caller access | Preserve; return to hub #ops |
| /forge-caller.html | Caller field workspace, lead queue and payouts | Preserve standalone worker access and Field panel |
| /forge-welcome.html | Stripe checkout success/cancel landing | Preserve billing callbacks |
| /forge-templates.html | Editable service starter concepts and HTML export | Preserve Templates panel and direct URL |

The hub gates panel loading on /api/room-history workbench.operator.
The customer builder uses a separate audience; do not redirect it to the owner hub.
lib/forgeStripe.js references forge-welcome.html for both checkout outcomes and
forge-caller.html for Connect onboarding returns. Static similarity is not a removal gate.

## Navigation contract

- Owner workspace Forge view remains unchanged.
- Hub exposes Nexus Home (/workspace.html?view=messages) only after operator access succeeds.
- Ops, Field and Templates keep their existing hash deep links and lazy panel loading.
- Admin returns to /forge-hub.html#ops with target=_top, so opening Admin inside the Ops iframe cannot nest another hub.
- Templates keeps its existing top-level return to Forge.
- Existing URLs, APIs, authentication, caller access and billing paths remain intact.

## Validation and remaining work

The focused e2e/forge-navigation.spec.mjs checks owner return, tab restoration,
keyboard navigation, nested Admin return and denied access at phone and desktop widths.
The Forge navigation workflow runs it separately from the broad accessibility suite.
Local browser execution may be unavailable; record actual CI results rather than treating
syntax checks as browser verification.

Next consolidation passes: trace remaining account/caller return paths, reconcile the
feature registry, review #843/#844 against main, and run signed-in production smoke checks.
Do not delete or redirect a page until its dependencies and audience have been verified.
