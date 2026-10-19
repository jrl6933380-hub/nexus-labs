# 3D language 1.1 verification

Run date: 2026-10-19. Base: main `0f5e829` plus this change.

- Ad suite: 270 passed, 1 skipped, 0 failed (271 total).
- New WebGL browser suite: 13 passed, 0 failed.
- Existing Stage 4c compositing browser suite: 12 passed, 0 failed.
- `git diff --check` passed. The built player is 89,158 bytes and remains below the existing 100,000-character creative-design cap. No dependencies or network exceptions were added.

The explicit WebGL suite used Chromium 153.0.8010.0 on Linux with ANGLE/SwiftShader software rendering, at 800×450 logical pixels and DPR 1. The 3D canvas renders at 2× logical resolution before capture. It verifies four procedural product presets, depth occlusion independent of draw order, mapped shadows (1,896 changed floor pixels when shadow casting is toggled), material changes (22,116 changed pixels), eight exact shuffled-seek comparisons, eight context disposals, alpha and three exact preview/still/sequence comparisons.

A 6-second 800×450/24fps H.264 MP4 was exported through the existing exporter and probed with ffprobe. This verifies an actual encoded file, rather than an HTML preview renamed as video. WebGL-unavailable capture was deliberately tested and refused with a clear renderer error.

The existing 2D compositing suite still passes its nested masks, keyed still/video seek-order checks, real alpha, selection/review packs, preview/still/sequence equality and lossy MP4 comparison. Capacity measurements remain offline capture/screenshot latency, not phone playback FPS.

Evidence:

- [3D machine-readable results](evidence/world3d/report.json)
- [Self-contained visual review and MP4](evidence/world3d/review.html) — download and open locally; no network is required.
- [2D regression results](evidence/world3d/compositing-regression.json)
- [Example project data](evidence/world3d/project.json)

Not verified: iPhone/Android GPU performance, Safari/WebKit, arbitrary imported models, photorealistic people, true reflections/refraction, point-light shadows or a deployed production render worker. This is a bounded geometry/material/light/camera foundation. The guide records those limits and the next increments.
