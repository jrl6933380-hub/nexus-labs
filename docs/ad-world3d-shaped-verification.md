# Shaped 3D geometry verification

Run date: 2026-10-19. Base: main `146bce5` (merged #665).

- Ad tests: 273 passed, 1 skipped, 0 failed.
- WebGL browser suite: 15 passed, 0 failed.
- Existing 2D compositing browser suite: 12 passed, 0 failed.
- Built player: 92,775 bytes, under the existing 100,000-character design cap. No dependencies or network allowances added.

New unit checks verify physical rounded-box radius and transformed normals on a thin, non-cubic case, radius-zero compatibility with boxes, profile ordering/range/size validation, bounded monotone interpolation, optional caps, finite unit normals and valid 16-bit indices at the maximum 32-point profile. Shape fields on unrelated primitives are rejected instead of silently ignored. MCP scene params retain their existing record envelope; semantic validation runs through the shared registry.

The WebGL suite ran in Chromium 153.0.8010.0 with ANGLE/SwiftShader on Linux, logical 800×450, DPR 1, with network requests blocked. It rendered all four presets. The continuous bottle body changed 5,532 pixels versus an assembly of cylinder/sphere parts; the rounded device changed 5,905 versus its hard-box equivalent. The bottle comparison retains the new cap in both frames; the device comparison holds all fields except shape/radius fixed. Images in the review sheet are labeled before/after.

Two different lathe profiles in the same scene were checked against a shared-profile baseline: changing only the right profile changed 12,802 right-side pixels and zero left-side pixels. This detects omission of profile data from the mesh cache key.

All previous 3D checks pass: draw-order-independent depth, mapped floor shadow, material response, eight shuffled-seek equality checks, eight context disposals, real alpha and three exact preview/still/sequence comparisons. A 6-second 800×450, 24fps H.264 file was exported and verified with ffprobe. Deliberately unavailable WebGL refuses capture with a clear error.

The unchanged 2D path passes nested masks, keyed still/video seek-order checks, alpha, selection/review packs, preview/export agreement, MP4 probes and capacity checks. Browser capture latency is not a claim about phone playback FPS.

Evidence:

- [Machine-readable 3D results](evidence/world3d-shaped/report.json)
- [Self-contained rendered review and MP4](evidence/world3d-shaped/review.html) — download and open locally; no network required.
- [Editable example project](evidence/world3d-shaped/project.json)
- [2D regression results](evidence/world3d-shaped/compositing-regression.json)

Not verified: Safari/WebKit or phone GPU performance. This change does not add mesh imports, textures, true reflections/refraction, interiors for hollow lathe objects, rigging or a deployed render worker. Existing saved scenes stay unchanged; new bottle/device briefs use the new geometry. No campaign was published and no merge is performed automatically.
