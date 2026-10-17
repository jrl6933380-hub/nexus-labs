# Exporting an ad to MP4

`scripts/export-ad-mp4.mjs` renders a vocabulary (v2) ad to an MP4. It drives the stock player one frame at a time through its capture barrier, checks that every frame was acknowledged, pipes the PNG frames into ffmpeg, and writes a manifest next to the video.

```
node scripts/export-ad-mp4.mjs --project ad.json --out ad.mp4 [--fps 30] [--scale 2] [--crf 18]
     [--audio music.mp3] [--images images.json] [--chromium /path/to/chrome]
```

- `--project` is a v2 project, or anything that carries one under `.project` (a `read_nexus_ad` result, a saved record). Use `-` to read stdin. The strict v2 validator runs first, so legacy ads and malformed input are refused.
- `--fps` 24, 30 or 60 (default 30). `--scale` 1, 2 or 3 (default 2): output is the logical size times scale, so portrait is 720x1280 at scale 2. `--crf` 12 to 28 (default 18, lower is higher quality).
- `--audio` mixes in a track, trimmed to the video length with a one second fade-out. A track shorter than the ad simply ends early.
- `--images` is a JSON file with the library pictures the ad uses, either `{ "img-id": { "src": "data:image/...", "source": "ai_generated" } }` or a list of library records. Needed only when a photo scene has an `imageId`. The export stops if a referenced picture is missing, so a missing image is never exported as the brand mark.
- stdout is one JSON line (`ok`, paths, size, frame count, fingerprint). Progress goes to stderr. Exit code is 1 on any failure, and a half-written video is never left behind.
- A manifest `<name>.manifest.json` is written beside the video: vocabulary version, format, fps, size, frame count, a hash of the project, and `framesSha256`.

## What it guarantees

- **Deterministic frames.** Every frame is a pure function of its timestamp. The same project at the same settings gives the same `framesSha256` on every run, regardless of ffmpeg version or machine, so an export can be re-checked later.
- **Every frame acknowledged.** For each frame the player's `window.__capture(ms)` renders exactly that time, waits for fonts, image decode and two paints, and returns a sequence number that is also stamped on the page. The script checks the number, the time and the stamp before it takes the screenshot, and aborts on any mismatch, page error, or wrong screenshot size.
- **Frozen setup.** Before frame 0 it checks that the player is frozen (`?capture=1`), the viewport and DPR match the plan, and the vocabulary version matches.
- **Honest labels.** The "Concept preview" badge is drawn by the player, so it is baked into the video. For a concept ad the script refuses to export if the badge is not visible.
- **No network.** The page is blocked from everything except `file:` and `data:` URLs.

## Requirements

Node 20+, Chromium through Playwright (`@playwright/test`, `playwright` or `playwright-core`), and `ffmpeg` on PATH. Point at a specific browser with `--chromium` or `CHROMIUM_PATH`.

Speed: about 0.16 seconds per frame at 720x1280 on a 2-CPU machine, so a 27 second ad at 30 fps (810 frames) took about 2 minutes 10 seconds. Scale 1 is faster.

## Where it can run

It runs anywhere with the requirements above: a laptop, a CI job, or an agent sandbox that has Chromium and ffmpeg.

It cannot run in the E2B helper in `lib/sandbox.js` as it is today. Measured on 2026-10-17, that sandbox has no ffmpeg or Chromium, runs as a non-root user, has about 470 MB of RAM, and each run is capped at 60 seconds and 8 commands, while a typical export takes a couple of minutes. A server-side `export_mp4` tool therefore needs a different runner (a longer-lived worker or pod, a CI job, or a Vercel Sandbox). That choice is not made here.

## Agent recipe

1. `read_nexus_ad` for the campaign, save the result to a file.
2. `node scripts/export-ad-mp4.mjs --project <file> --out <name>.mp4`
3. Send the MP4 to the person.

## Not included yet

Captions, a music library, uploading the result (for example to Vercel Blob), and an `export_mp4` tool that does all of this on the server. Photo and logo scenes use the brand mark until v2 ads can carry images.

## Tests

`test/ad-export.test.mjs` covers the planning, validation, seeding, ffmpeg arguments and frame checks without a browser. One more test runs the whole pipeline and is skipped unless you ask for it:

```
AD_EXPORT_E2E=1 node --test test/ad-export.test.mjs
```
