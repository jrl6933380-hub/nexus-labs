# Competitor Page Change Monitor

Know when a competitor changes their pricing, plans or services. **Type their website. That's it.** The Actor finds the pages that matter, remembers them, and on every later run tells you **what was added and what was removed**, with the source URL and a timestamp as evidence.

No account elsewhere, no dashboard to sign up for, no code. Run it by hand, on a schedule, or from the API or an AI agent. It reads pages built with JavaScript too.

## What you get

- **Pages found for you**: give it `acme.com`, it finds their pricing, plans and services pages
- **Changed / unchanged / first-seen** status for every page
- **Added and removed passages** (up to 8 each, so you read the change, not the whole page)
- **Price strings spotted on the page** (for example `$39/month`), copied exactly as written
- **Evidence on every row**: requested URL, final URL, capture time, previous capture time, page title, content hash, how the page was read
- **A run summary** listing which URLs changed and which competitors had no page found
- **Honest gaps**: if a page can't be read, you get a failed row saying why. Failed pages are never charged and never overwrite your saved copy.

## How to use it

1. Type your competitors' websites (`acme.com`, `rival.io`) and run it once. Every page found is saved as a **baseline**.
2. Run it again later, or put it on a schedule (daily or weekly works well). Changed pages show what moved.
3. Use Apify's schedules, webhooks and integrations to send results to Slack, email, Google Sheets, Zapier or your own tools.

Your saved pages live in a private storage in **your own Apify account**. Nothing is shared with other users.

### Input

```json
{
  "competitors": ["acme.com", "rival.io"],
  "pagesPerCompetitor": 3,
  "urls": [],
  "renderMode": "auto"
}
```

| Field | What it does |
|---|---|
| `competitors` | Up to 20 competitor websites. The Actor finds their pricing, plans and services pages from the homepage links and sitemap. |
| `pagesPerCompetitor` | How many of the best matches to watch per website (1 to 5, default 3). |
| `urls` | Optional exact page addresses (up to 50), watched first. Use it for pages the finder misses. |
| `maxPages` | Hard cap on pages per run in total (default 10, max 50). |
| `renderMode` | `auto` (default): read the HTML, switch to a real browser only if a page needs one. `html`: never use a browser. `browser`: always use one. |
| `rememberBaselines` | Save each page for next time (default on). Turn off for a one-off run. |
| `baselineStoreName` | Name of the storage that holds saved pages. Use different names for separate watchlists. |
| `includeText` | Include the page text in each output row (max 24,000 characters). |
| `previousResults` | Optional. Compare against rows from an earlier run instead of the saved pages. |

### Output (one row per page)

```json
{
  "schemaVersion": 1,
  "competitor": "acme.com",
  "discoveredFrom": "link",
  "requestedUrl": "https://acme.com/pricing",
  "url": "https://acme.com/pricing",
  "status": "captured",
  "comparison": "changed",
  "captureMethod": "browser",
  "title": "Pricing",
  "capturedAt": "2026-10-22T16:00:00.000Z",
  "previousCapturedAt": "2026-10-21T16:00:00.000Z",
  "observedAmounts": ["$39/month"],
  "added": ["Starter $39 per month"],
  "removed": ["Starter $29 per month"],
  "error": null
}
```

`comparison` is `baseline` (first time seen), `changed`, `unchanged`, or `unavailable` (the page could not be read). `discoveredFrom` is `link`, `sitemap` or `guess` for found pages; it is absent for pages you listed yourself.

If you switch `renderMode` and a page is read a different way than last time, the Actor starts a fresh baseline for it (`baselineReset: true`) instead of reporting fake changes.

A `SUMMARY` record in the run's key-value store lists counts, changed URLs and competitors with no page found. Those competitors also get a free row telling you to add their page address.

## Pricing

You pay per page successfully read:

- `page-result`: a page read from its HTML.
- `browser-page-result`: a page that needed a real browser (it uses more compute, so it costs more).

First-seen, changed and unchanged pages each count as one result. Pages that fail and competitors with no page found are not charged. Set a maximum cost per run and the Actor stops when it is reached; results gathered so far are kept. Platform pricing is shown on this Actor's page.

## Good to know

- **Page finding is a best guess.** It looks for pricing, plans, packages, services and similar pages on the same website. Check the first run's results and add exact addresses in `urls` for anything it missed or got wrong.
- **Browser reading handles JavaScript, not logins.** Pages behind a login, a CAPTCHA, or heavy bot protection can still fail. You'll see a failed row, not a wrong answer.
- **Small wording changes show up.** It compares text, so a changed headline appears as a change. It does not judge whether a change matters.
- **Observed prices are strings, not facts about plans.** `$39` means that text appeared on the page.
- **Public pages only.** HTTPS on the standard port, no logins, no cookies, no private networks.
- **Be a good citizen.** Only monitor pages you are allowed to read, at a reasonable frequency, and follow each website's terms.
- A page that times out or returns a temporary server error is retried once.

## FAQ

**Do I need to paste page addresses?** No. Type the competitor's website and the Actor finds the pages. Exact addresses are optional.

**Do I need to paste old results each time?** No. Saved pages are used automatically. `previousResults` is only for overriding them.

**Where is my data stored?** In a key-value storage in your own Apify account, named by `baselineStoreName`. Delete that storage to reset.

**Can I watch more than 50 pages?** Run several watchlists, each with its own `baselineStoreName`, on separate schedules.

**Does it explain why a change matters?** Not yet. It reports the evidence; interpretation is up to you or your AI agent.

## Roadmap

Screenshots, public ad libraries, and AI summaries of changes are planned as later versions. Tell us what you need in the Issues tab.

---

### For maintainers

The repository root is the build context; `.actor/actor.json` points at this folder's Dockerfile and schemas.

```sh
node --test test/intelligence.test.mjs test/intelligence-batch.test.mjs test/intelligence-browser.test.mjs
docker build -f actors/intelligence/Dockerfile -t nexus-intelligence .
```

The image is `apify/actor-node-playwright-chrome:22-1.56.0`; its Playwright version must match `actors/intelligence/package.json`. Browser tests need the `playwright` package and Chromium and are skipped when they are missing. Pricing is configured in Apify Console; the code only emits the `page-result` and `browser-page-result` events. In Console, remove (or price at zero) the built-in `apify-default-dataset-item` event: otherwise every row pushed, including free failure rows and no-page-found rows, would be billed, and the "failed pages are not charged" promise above would be false.
