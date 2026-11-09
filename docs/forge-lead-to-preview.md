# Forge lead → preview + pitch (local, on the Ally)

Goal: choose businesses with no website, then get a concept site preview and a call pitch for each. Nothing is sent, called, posted or published.

## Flow
1. **Find** (existing, owner-visible): `Find Forge Leads` / `forge-leads.mjs` takes a business type and a city, checks Google and Maps, and saves a review under `%LOCALAPPDATA%\NexusAlly\forge-leads\batches\batch-<id>`.
2. **Choose**: list the saved batch, then pick by number (or `eligible`).
   `node scripts\ally\forge-preview.mjs --batch latest --list`
3. **Build**: `node scripts\ally\forge-preview.mjs --batch latest --pick 1,3` (or `--pick eligible`).
   Output goes to a NEW folder `forge-leads\previews\<batch>-<timestamp>\` and is never overwritten:
   `index.html`, `pack.json`, and per lead `editorial.html`, `bold.html`, `fresh.html`, `pitch.txt`, `pitch.json`.
   Receipt: `FORGE_PREVIEW_READY leads=N files=N dir=...`.

## What it will and will not do
- Uses the shared deterministic renderer (`public/forge-service-templates.js`) and pitch (`public/forge-pitch.js`). No model, browser, network or credentials.
- `eligible` means "no dedicated site found" or "social / booking only", not a duplicate. A lead that already has a website is refused. A `needs_checking` lead is built only when picked by number, and is marked unverified.
- Phone numbers from listings are suggestions: they appear in `pitch.json` and the index, never inside a preview site.
- Previews show sample services marked as samples; no invented reviews, prices, hours or photos.
- Pricing is quoted only with `--launch-offer` (the approved $20 total at signup then $10/month, from `lib/forgeProgram.js`). Without it the pitch says to confirm the approved offer first.
- The pitch states findings without a "checked on" date, because that date is only shown for owner-confirmed research.

## Install on the Ally (checksum-pinned)
`install-forge-preview.ps1 -Revision <merged commit> -PreviewSha256 -TemplatesSha256 -PitchSha256 -ProgramSha256` downloads exactly these four files from the pinned commit, size- and hash-checks them and syntax-checks them. Use `-StageOnly` to verify without activating. Hash each file from the merged commit; never from a branch.

## Qwen reliability change (same PR)
- A verified ad macro (`start_ad`, `preview_ad`, `variants_ad`, `package_ad`) now ends the job with its receipt. Qwen is not asked for further steps after the macro succeeds.
- The site starter now picks the barbershop and salon layouts for plural wording ("Barbers", "Salons").

## Not in this PR
Letting Qwen start the lead search or this macro by itself, and any wider Qwen access. Those are the next stage and need the same owner-approval gates as the other macros.
