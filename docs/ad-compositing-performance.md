# Ad compositing: capacity and performance budgets

Stage 1 of the compositing workspace. Measured in headless Chromium with software rendering, so a real GPU browser should do better.

## Limits (no silent dropping)
- Layers per graphic scene: 2048 (was 48). Expanded shapes (count/emit): 10000 (was 200).
- Saved ad size: 400 KB (was 180 KB), which a 2048-layer scene needs.
- Anything over a limit is a validation error that names the scene and layer count. Nothing is truncated quietly.

Measured at the new ceiling (headless Chromium, software rendering, plain shapes with some keyframes):
| Scene | Expanded shapes | ms/frame |
|---|---|---|
| 2048 layers | 2048 | ~40 |
| 2048 layers, 4 copies each | 8192 | ~58 |
| 416 layers, 24 copies each | 9984 | ~110 |
Effects (glow/blur/shadow) are far more expensive than shape count; see below.

## Cost estimate (advisory)
Each layer has an estimated cost. It never blocks an ad: the only hard limits are the layer and shape caps above. `listLayers` reports the total and flags it above 1200 so an agent can see where a heavy scene spends its time.
Plain shape 1; glow/blur/shadow/rGlow +12; clip/mask/isolate/blend +3; path +2; video +30; keyed image +20; keyed video +150; multiplied by count or emit.
Heavy scenes render more slowly; putting an effect on a group instead of every child is the main fix.

## Measured per-frame cost
| Scene | Layers | ms/frame |
|---|---|---|
| plain shapes | 800 | ~20 |
| plain shapes | 1600 | ~37 |
| per-layer glow/blur/shadow | 200 | ~120 |
| per-layer glow/blur/shadow | 800 | ~485 |
| per-layer glow/blur/shadow | 1600 | ~1000 |

Bottleneck: CSS filters (about 0.6 ms each). DOM node count is a distant second. Apply an effect to a group once instead of every child.

## Layer metadata added
name, role, visible, locked, z (explicit stacking), sx/sy, pivotX/pivotY, cropL/T/R/B, and group timeline controls trate/toffset/tloop.
All optional; existing projects render unchanged.

## Chroma key (stage 2)
Keying runs on a proxy canvas capped at 1024px on its long side, so cost does not grow with export size. A keyed still is processed once; keyed footage once per frame.
Measured in Node (single thread), worst case with matte grow, feather and spill all on:
| Proxy size | ms/frame |
|---|---|
| 512x340 | 27 |
| 1024x680 | 94 |
Stills and exports wait for the keyed frame to be drawn (same capture barrier as video seeks), so a slow frame costs time, never correctness. Live preview of large keyed footage may drop below real time; budget one or two keyed videos per scene.

Seeking: a keyed clip rendered at six times in sequence, reverse and shuffled order produced identical frames.

Known limits: dark or low-saturation subject edges near the key (black hair) key partly transparent unless tolerance is lowered; very fine strands are lost; spill suppression is channel-average based and does not fully recolour tinted red or yellow edges. Use a garbage matte or supplied mask for those (stage 3).

## Selection map (stage 3a)
`export-ad-still.mjs --view selection` renders the scene with every layer as one flat, unique, non-grey color (no art, blend, glow or alpha softness) and writes `<out>.selection.json` beside the PNG: the legend (layer id, color, name, role) plus per-layer pixels, coverage %, bounding box and center, and whether it is visible at that moment.
- Colors come from the layer ids only (stable hash, collision-probed in sorted order), so a layer keeps its color across renders and edits. Anonymous layers are listed as `#<index>` with `anonymous: true`; give them ids to keep them stable.
- Keyed layers use their matte as the shape. Images and video use their full box (cropped layers use the crop).
- `lib/adSelect.js`: `selectionReport`, `pickAt` (which layer is at x%,y%, majority vote of a small window) and `findInLegend`.
- Antialiased edges blend to non-legend colors and are ignored, so edge pixels count toward no layer.
- Flattened uploads: a selection map only separates layers that exist. A flat image is one layer; splitting it needs a supplied mask, a key, manual work or an optional segmentation model, and hidden content behind another object cannot be recovered.
