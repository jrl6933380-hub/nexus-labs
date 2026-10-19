# Ad compositing Stage 4c capability report

Verified locally on 2026-10-19 against the Stage 4a/4b code from main (base `52ae96d`) plus the fixes in this change. This is a synthetic calibration and regression suite, not a camera-footage quality assessment.

## Result

All **12 browser checks pass**, including real decoded WebM, nested masks, alpha, selection maps, preview/still/sequence agreement and an encoded MP4. Machine-readable results: [report.json](evidence/compositing-stage4c/report.json).

Two defects found while taking over Stage 4c:

- **Anonymous layer addressing:** `read_nexus_layers` now projects the same deterministic IDs and names that edits persist. Lists, finds and single-layer reads return usable IDs and consistent hashes. Reads and dry runs do not save. The campaign baseline still guards saved edits. `anonymous` in the scene summary counts stored anonymous layers; `generated_ids` in a scene read counts projected IDs. The first successful edit persists these IDs, so selection colours on old anonymous layers may change once at that first save. Unspecified roles remain unspecified.
- **Keyed-video capture race:** `currentTime` can advance before decoded pixels are ready. Eager draws no longer cache during a seek; capture sync refreshes video pixels after the video barrier even if the timestamp matches a previous eager draw. Two deterministic decoder/cache regression tests reproduce these states.

## Demonstration and review

[Self-contained review](evidence/compositing-stage4c/review.html) includes the sheet, 6-second MP4 and transparent PNG. Download the HTML and open locally; all media is embedded, with no network requests.

The runner draws a robot and thin antennae on a green screen, rasterizes 24 source frames and encodes a lossless synthetic WebM. It then keys that media over a replacement background, applies a garbage matte and an animated crop reveal. This exercises actual video seeking/decoding without requiring account access or external media. It tests simple solid shapes and antialiased edges, not hair, smoke, motion blur or camera lighting.

The review pack includes final, selection, original, foreground and matte views. Selection colours identify layers, independently of their artwork colours:

| ID | Name | Role | Selection colour |
|---|---|---|---|
| `backdrop` | Replacement backdrop | background | `#249224` |
| `sun` | Backdrop light | light | `#00ff49` |
| `subject` | Synthetic robot on green | subject | `#6db66d` |
| `label` | Synthetic disclosure | text | `#24b6ff` |

## Pixel checks

- Six independent probes verify parent keep, animated parent cut and child keep intersection, including regions that must disappear.
- Nested masks, keyed stills and keyed WebM are each sought at 0, 250, 500, 1000, 1500 and 2750 ms; 12 reverse/shuffled comparisons per fixture must have identical decoded PNG pixels after compositor warmup.
- Cold Chromium startup is reported separately: the keyed fixtures change 77 circle-edge pixels (0.025% of the frame, max channel delta 16/255) between the first frame and the warmed compositor. The runner explicitly allows at most 0.05% pixels and 16/255 for this cold/warm check; it does not apply that tolerance to warmed seek comparisons. Nested masks have zero cold difference in this run.
- Alpha PNG has transparent backdrop, opaque body and 6,076 partially transparent antialiased pixels. The concept badge remains visible.
- The live `renderAdFrame` result equals capture, standalone still export and the corresponding sequence frame exactly at 1500 ms (decoded PNG equality).
- Actual MP4 is H.264/yuv420p, 560×560, 24 fps, 6 seconds. Decoded frame 36 has mean absolute RGB error 1.6374/255 versus preview, under the explicit 4/255 compression tolerance. Lossy MP4 pixels are not claimed byte-identical.
- A missing matte asset is refused by export preflight rather than silently drawn without its mask.
- The 2048 layer and 10000 expanded-shape limits reject overflow; nothing is silently truncated.

## Measured capacity

Environment: 153.0.8010.0 Chromium, v24.19.0 Node, linux/x64, AMD EPYC 9V74 80-Core Processor; 560×560, scale 1.

Seven warmed samples per case. Values include the capture barrier (media/fonts and two paints) **plus PNG screenshot wall time**. P95 is the nearest-rank maximum of seven samples. These are offline frame latencies, not renderer-only CPU time, live phone FPS or production service throughput. Small cases are dominated by the capture/paint floor; this run does not establish an effects speedup.

| Case | Layers | Expanded shapes | Median ms | P95 ms |
|---|---:|---:|---:|---:|
| plain-128 | 128 | 128 | 50.31 | 53.96 |
| plain-512 | 512 | 512 | 50.11 | 52.07 |
| plain-1200 | 1200 | 1200 | 50.24 | 51.91 |
| plain-2048 | 2048 | 2048 | 51.12 | 52.29 |
| expanded-9984 | 416 | 9984 | 150.3 | 161.75 |
| effects-128 | 128 | 128 | 50.73 | 52.94 |
| group-effects-128 | 129 | 129 | 49.99 | 51.11 |
| keyed-still | 4 | 4 | 111.78 | 119.99 |
| keyed-video | 4 | 4 | 117.85 | 165.42 |

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run test:ad-compositing -- --out test-results/compositing
# Or use an already installed compatible Chromium:
npm run test:ad-compositing -- --out test-results/compositing --chromium /path/to/chromium
node --test test/ad-*.test.mjs
```

Needs Node 20+, Playwright/Chromium and ffmpeg/ffprobe on PATH. All fixture assets are generated locally. Browser pages block network access; no API keys, saved campaign mutations or paid generation are used. This run used an npm-distributed Chromium binary because the standard browser CDN download failed in the execution environment; that workaround is not added as a project dependency.

## Remaining limits and next work

- No production worker was deployed by this change. Connector jobs can queue, but local rendering success does not prove a production worker is online or shares the app's KV store. Deploying a worker and verifying queue claim/download is a separate operational task.
- Real camera footage remains untested. Do not claim photorealistic extraction or production quality on hair, transparent fabric, smoke, reflective products, motion blur, uneven screens or heavy spill from these synthetic results.
- This run covers square scale-1 capture on desktop Chromium. Other export scales/aspects, real phone playback, Safari/WebKit and multi-video concurrency need their own measurements.
- Straight polygon mattes, PNG-only separability input, the 240-frame sequence cap and selection-map antialiased unmatched pixels retain the prior documented limits.
- Nothing was merged, deployed, published as a campaign or sent to an advertising platform as part of Stage 4c.
