# Competitor Page Change Monitor

Know when a competitor changes a page. Give this Actor the exact public pages you care about (pricing, plans, services, landing pages). It reads each one, remembers it, and on every later run tells you **what was added and what was removed**, with the source URL and a timestamp as evidence.

No account elsewhere, no dashboard to sign up for, no code. Run it by hand, on a schedule, or from the API or an AI agent.

## What you get

- **Changed / unchanged / first-seen** status for every page
- **Added and removed passages** (up to 8 each, so you read the change, not the whole page)
- **Price strings spotted on the page** (for example `$39/month`), copied exactly as written
- **Evidence on every row**: requested URL, final URL, capture time, previous capture time, page title, content hash
- **A run summary** listing which URLs changed
- **Honest gaps**: if a page can't be read, you get a failed row saying why. Failed pages are never charged and never overwrite your saved copy.

## How to use it

1. Paste your competitor URLs and run it once. Every page is saved as a **baseline**.
2. Run it again later, or put it on a schedule (daily or weekly works well). Changed pages show what moved.
3. Use Apify's schedules, webhooks and integrations to send the results to Slack, email, Google Sheets, Zapier or your own tools.

Your saved pages live in a private storage in **your own Apify account**. Nothing is shared with other users.

### Input

```json
{
  "urls": ["https://www.iana.org/help/example-domains"],
  "maxPages": 10,
  "rememberBaselines": true,
  "baselineStoreName": "nexus-intelligence-baselines",
  "includeText": true
}
```

| Field | What it does |
|---|---|
| `urls` | 1 to 50 exact public HTTPS pages. Duplicates are read once. The Actor never crawls beyond what you list. |
| `maxPages` | Hard cap on pages per run (default 10, max 50). |
| `rememberBaselines` | Save each page for next time (default on). Turn off for a one-off run. |
| `baselineStoreName` | Name of the storage that holds saved pages. Use different names for separate watchlists. |
| `includeText` | Include the page text in each output row (max 24,000 characters). |
| `previousResults` | Optional. Compare against rows from an earlier run instead of the saved pages. |

### Output (one row per page)

```json
{
  "schemaVersion": 1,
  "requestedUrl": "https://example-competitor.com/pricing",
  "url": "https://example-competitor.com/pricing",
  "status": "captured",
  "comparison": "changed",
  "title": "Pricing",
  "capturedAt": "2026-10-22T16:00:00.000Z",
  "previousCapturedAt": "2026-10-21T16:00:00.000Z",
  "observedAmounts": ["$39/month"],
  "added": ["Starter $39 per month"],
  "removed": ["Starter $29 per month"],
  "error": null
}
```

`comparison` is `baseline` (first time seen), `changed`, `unchanged`, or `unavailable` (the page could not be read).

A `SUMMARY` record in the run's key-value store lists counts and the URLs that changed.

## Pricing

You pay per page successfully read (the `page-result` event). First-seen, changed and unchanged pages each count as one result. Pages that fail are not charged. Set a maximum cost per run and the Actor stops when it is reached; results gathered so far are kept. Platform pricing is shown on this Actor's page.

## Good to know

- **It reads the page's HTML text.** Pages that only show their content after JavaScript runs, sit behind a login, or block automated visitors can fail. You'll see that as a failed row, not a wrong answer.
- **Small wording changes show up.** It compares text, so a changed headline appears as a change. It does not judge whether a change matters.
- **Observed prices are strings, not facts about plans.** `$39` means that text appeared on the page.
- **Public pages only.** HTTPS on the standard port, no logins, no cookies, no private networks.
- **Be a good citizen.** Only monitor pages you are allowed to read, at a reasonable frequency, and follow each website's terms.
- A page that times out or returns a temporary server error is retried once.

## FAQ

**Do I need to paste old results each time?** No. Saved pages are used automatically. `previousResults` is only for overriding them.

**Where is my data stored?** In a key-value storage in your own Apify account, named by `baselineStoreName`. Delete that storage to reset.

**Can I watch more than 50 pages?** Run several watchlists, each with its own `baselineStoreName`, on separate schedules.

**Does it explain why a change matters?** Not yet. It reports the evidence; interpretation is up to you or your AI agent.

## Roadmap

Screenshots, JavaScript-rendered pages, public ad libraries and AI summaries of changes are planned as later versions. Tell us what you need in the Issues tab.

---

### For maintainers

The repository root is the build context; `.actor/actor.json` points at this folder's Dockerfile and schemas.

```sh
node --test test/intelligence.test.mjs test/intelligence-batch.test.mjs
docker build -f actors/intelligence/Dockerfile -t nexus-intelligence .
```

The Actor reuses `lib/intelligenceCapture.js` (the same capture engine as the Nexus app) and installs the Apify SDK only inside this package. Pricing is configured in Apify Console; the code only emits the `page-result` event.
