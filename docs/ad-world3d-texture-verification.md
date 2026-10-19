# Surface maps verification

Run date: 2026-10-19. Base: main `f5c46fb` (merged #666). Language 1.3.0, project specVersion 2.

- Ad unit/integration suite: 275 passed, 1 skipped, 0 failed.
- WebGL browser suite: 20 passed, 0 failed.
- Existing 2D compositing browser suite: 12 passed, 0 failed.
- Player: 96,345 bytes, under the existing 100,000-character design cap. No new dependencies or network allowances.

The unit tests cover image-ID validation, map settings, eight-distinct-image budget, group rejection, shared asset collection and missing-image export preflight. An injected connector test verifies that the connected account's image resolver runs before save and a missing surface map prevents the write.

The WebGL suite uses Linux Chromium 153.0.8010.0 / ANGLE SwiftShader, logical 800×450, DPR 1, with network requests blocked. Synthetic 300×190 PNG artwork deliberately exercises non-power-of-two textures; it is test artwork, not a photographed or scanned material. Box, cylindrical, spherical and planar mapping each change over 20,000 pixels versus an untinted white surface. Shuffled seeks reproduce identical decoded pixels for every projection. Roughness-map and repeat/offset variations alter the rendered surface. The initial roughness fixture placed its contrasting region away from the visible hemisphere; the fixture was corrected and the full suite rerun.

Textured preview, still and sequence exports agree exactly at the same timestamp. A textured six-second 800×450/24fps H.264 export is verified by ffprobe. The suite also exports the original untextured six-second 3D clip. Texture-loaded captures retain background alpha and survive three scene departures/returns with exact pixels. The existing geometry, shadows, depth, materials, deterministic seeking, context disposal and unsupported-WebGL checks remain green.

Corrupt data is deliberately tested. Capture refuses with:

```text
Render error: 3D surface map "img-0000000001": image decode failed.
```

GPU maps are proportionally limited to 1024px longest side and eight unique images per scene. Images above 16MP are refused after decode. This does not bound transient pre-decode memory; no decompression-bomb protection claim is made. The new dimension guard, decode timeout and cancellation during a still-pending decode are code paths, not separately fault-injected browser assertions in this suite.

Evidence:

- [3D machine-readable results](evidence/world3d-textures/report.json)
- [Self-contained image/video review](evidence/world3d-textures/review.html) — download and open locally.
- [Textured project](evidence/world3d-textures/textured-project.json) and [synthetic image fixtures](evidence/world3d-textures/texture-images.json)
- [2D regression results](evidence/world3d-textures/compositing-regression.json)

Not verified: Safari/WebKit, phone GPU performance, photographic material quality or cross-device pixel identity. Maps modulate colour and roughness only: alpha is ignored, shadows use full geometry, and projection seams/filtering limits are documented in the language guide. No normal/displacement maps, imported UVs/meshes, environment reflections or worker deployment are added. No campaign was published and the PR remains for human review.
