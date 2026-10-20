# Nexus campaign handoff for Claude — 2026-10-20

Justin asked ChatGPT to save and merge the campaign work so Claude can continue it.

## Creative direction approved in this conversation

Each business gets its OWN fresh conversation with Nex: customer brief, Nex response, ChatGPT as Design, Claude as Builder, an inline project card and a direct cut into that business's complete website preview. Keep all agent updates inside one conversation. Do not insert a separate team screen or replace the full websites with tiny ad cards. Make new videos by adding episode configuration rather than redesigning the common chat scene.

Offerings include business websites AND custom AI tools, usable inline controls and visual spaces for compatible chat models. Do not imply they are limited to Justin's personal Nexus Board.

These are scripted illustrative conversations and actual saved concept-site captures. The business is human-led by Justin using ChatGPT and Claude. No live autonomous customer build is shown. No ad has been posted and no paid campaign has been launched.

## Authoritative completed work

The full campaign source was committed and pushed through Sites at commit `7b78c757917dde754000834e8c91538456a22907`. Project ID: `appgprj_6ad6fdf5b7f08191afb3bee290317ca6`.

Owner-private campaign: https://nexus-ad-collection.mauveshore6.chatgpt.site
- `/campaign.html`: campaign collection.
- `/video-series.html`: five standalone episodes and downloads.
- `/first-tiktok.html`: combined compilation.
- `/sneakers.html`: Sole Exchange, resale shop with filters, product details and bag.
- `/wraps.html`: FORM / FILM, finish selector and vehicle project brief.
- `/streetwear.html`: SIDE A, product details, sizes and concept bag.
- `/desserts.html`: Little Lift, six/twelve bite box mixer and local bag.
- `/beats.html`: ROOM 04, original demo loops, playback, seeking, track switching, licenses and bag.
- `/ai-workspaces.html`, `/quote-builder.html`, `/learning-space.html`, `/connected-studio.html`: service presentation and AI workspace demos.

Preserve owner-private access. A private Site URL is not a public customer-accessible asset URL.

## Editable GitHub copy: partial archive, not a finished mirror

Private repo: https://github.com/jrl6933380-hub/nexus-campaign-studio
Branch: `archive/campaign-2026-10-20`.

Confirmed present by listing the private branch:
- `campaign-src/oracle-tiktok/episodes.json` and generated `episodes.js`.
- `chat-scene.html`, `oracle.js`, `capture.cjs`, `capture-series.cjs`, `export-series.py`, historical `assemble.py`, README and old video-manifest.json.
- Root build scripts, catalog, design notes and checks; additional campaign source files.

IMPORTANT: the bulk copy was interrupted when ChatGPT's selected execution environment became unavailable. `dist` was observed to contain only ad-manifest.json and ai-workspaces.html at the status check. `.asset-store` contains SOME base64 asset parts, not a complete media library. No binary-assets.json completeness manifest or restoration script was finished. Do not treat this branch as a full runnable backup, decode arbitrary incomplete parts, or report that all media is mirrored. The complete source and actual assets remain in the authoritative Sites project above, with delivered MP4s also saved in ChatGPT Library.

The repo creation tool automatically linked a Vercel project; `vercel.json` on main and the archive branch sets `ignoreCommand` to `exit 0` to skip automatic builds. Do not publish this private archive as an unauthenticated Vercel site.

## Finished videos saved in ChatGPT Library

| File | Duration | Library file ID |
| --- | --- | --- |
| Nexus-Sole-Exchange.mp4 | 36s | libfile_dd3a0aeb2b2c8191a817f3192be5fc31 |
| Nexus-Form-Film.mp4 | 40s | libfile_8fb8799d44b48191bd558a761c11d06c |
| Nexus-Side-A.mp4 | 40s | libfile_23c2398987fc8191b0525a40c6537f32 |
| Nexus-Little-Lift.mp4 | 44s | libfile_5d5429dcfd408191a41cd45f342e9fbd |
| Nexus-Room-04.mp4 | 36s | libfile_c9e56e44b02481918affbecf115554d2 |
| Nexus-First-TikTok.mp4 | 172s | libfile_01556f4771bc8191b36093014a19dc79 |

Main cover: Nexus-First-TikTok-Cover.jpg, Library ID `libfile_59f244eb90e88191bf01d1307faa66cf`. Compilation and cover were successfully replaced as version 3. Standalone files were created at version 0. Library is not automatically accessible to Claude; use the connected owner's authorized access rather than assuming these IDs are download URLs.

Authoritative deployed assets: `/assets/video-series/<standalone filename>` and `/assets/nexus-first-tiktok.mp4`. Covers match each standalone export name with `-Cover.jpg`.

## Reusable pipeline

`episodes.json` contains slug, brand, title, exportName, previewSec, request, nex, design, builder, designResult and builderResult. Add a new site and a new record to create another episode. `capture-series.cjs` accepts an optional slug and generates episodes.js. It captures the shared chat at 15fps; export-series.py outputs 1080x1920, 30fps H.264/yuv420p with AAC original ROOM 04 music. Each episode has 20s conversation, its own 10-18s full-page pan, then a 6s invitation. The compilation trims repeated invitations and contains one final CTA. Its chapter starts are 0, 30, 64, 98 and 136 seconds; total 172 seconds.

Regenerate after obtaining the complete saved source and assets:

```sh
CHROMIUM_PATH=/path/to/chrome node campaign-src/oracle-tiktok/capture.cjs /absolute/captures
CHROMIUM_PATH=/path/to/chrome node campaign-src/oracle-tiktok/capture-series.cjs /absolute/captures
python3 campaign-src/oracle-tiktok/export-series.py --captures /absolute/captures --out /absolute/exports
```

Optional single-episode export: add `--episode <slug>` to export-series.py, and pass the slug as the final capture-series.cjs argument. Requires Node, Playwright, Chromium, Pillow, ffmpeg and DejaVu Sans.

## Verification already completed

All five episode chat captures passed: correct brand, matching thumbnail, card within message viewport and no page errors. Site pages were captured full length. The final compilation was rebuilt to fix timestamp joins, then verified at exactly 172 seconds with clean complete ffmpeg decode. All six MP4s are 1080x1920 H.264 with AAC. `check.py` passed 44 pages for document/link/asset integrity, audio decode, JavaScript syntax and original-page contrast checks. Actual iPhone playback and TikTok crop/caption overlay review remain pending.

## Next action

Read the private episode JSON and scene source to understand the format immediately. When a writable execution environment is available, reopen the authoritative Sites source at the saved revision and finish a conventional Git mirror to the private campaign repo, including a checksum inventory for all media. Avoid another lengthy custom chunk upload. Keep the campaign private; do not post ads or deploy customer sites merely to complete the handoff.
