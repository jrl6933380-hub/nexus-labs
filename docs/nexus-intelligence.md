# Nexus / Intelligence

Standalone entry: `/intelligence` (also `/intelligence.html`). Source lives in the main Nexus repository; customer data is isolated under `nexus:intelligence:v1:<authenticated user>`.

## First working slice

- Existing Nexus customer sign-in and signup, with the owner-session bridge supplied by `getRequestUser`.
- Persistent watchlist: up to 12 competitors, three public HTTPS page URLs each.
- Manual page capture: normalized public HTML text, title, URL, capture timestamp and SHA-256.
- The second distinct capture creates added/removed text evidence. Unchanged checks retain the last distinct comparison. Failed checks retain both successful captures and expose the coverage gap.
- Saved research pages, persistent notes and a downloadable Markdown brief.
- “Powered by Nexus Labs” links to the Nexus landing/sign-in entry.

No new packages, model provider keys or billing configuration are needed. Storage uses the existing `KV_REST_API_URL` and `KV_REST_API_TOKEN`. This does not grant a paid plan or collect subscriptions.

## Capture boundaries

No browser executes target-page JavaScript. Screenshots, rendered-page collection, public ad ingestion, AI analysis, automated monitoring, email delivery and product-specific billing are not implemented in this slice. The UI and API capabilities state this explicitly. A text card is labelled as extracted text, never a screenshot. JavaScript-only/challenged pages return an inspection gap instead of a guessed result.

Captures allow HTTPS on port 443 only, reject credentials and private/special IP ranges, validate DNS and pin the inspected address to the HTTPS socket, revalidate redirects, limit downloaded bodies to 1 MB and retain at most 24,000 extracted characters. Calls have a total network budget; no target credentials or user cookies are forwarded. The extractor is a bounded HTML-text heuristic, not a complete DOM renderer; changes can include benign content edits. Results do not claim changes caused commercial performance.

All writes require same-origin JSON and authenticated server identity. A per-account lock serializes mutations, and a daily 60-attempt capture allowance bounds collection. The lock expires after 90 seconds; the API's requested runtime limit is 60 seconds. The brief records source text as evidence, not model instructions.

## Design fingerprint

Purpose: calm, inspectable competitive research. Composition: persistent compact navigation, an observation feed, a research board, a watchlist and an evidence dialog. Typography: restrained system sans with editorial headings and readable source excerpts. Material: warm paper surfaces, forest-green actions and amber inspection gaps. Signature: an original-source comparison before any interpretation. Mobile navigation wraps above the workspace; evidence comparisons stack. Preserve the approved concept's visual identity under the Nexus / Intelligence name.

## Verification

Run `node --test test/intelligence.test.mjs`. The suite covers tenant separation, source validation, redirect protection, failed/unchanged capture retention, concurrency, limits, notes, source-backed exports and API authentication/origin behavior. Browser QA and a live authenticated deployment smoke test must be reported separately; fixture results do not prove production connectivity.

## Next complete increments

1. A browser capture worker with real durable screenshots and explicit capture outcomes.
2. Research search/discovery through the existing web-search integration; save selected results into the same evidence model.
3. Source-backed AI breakdowns with cost accounting and no execution of instructions embedded in captured pages.
4. Scheduled monitoring, notifications, ad-source adapters and standalone product billing.

Build each against the same authenticated service boundaries so the standalone product and Nexus workspace can share capabilities.
