# Ad compositing: capacity and performance budgets

Stage 1 of the compositing workspace. Measured in headless Chromium with software rendering, so a real GPU browser should do better.

## Limits (no silent dropping)
- Layers per graphic scene: 512 (was 48). Expanded shapes (count/emit): 2000 (was 200).
- Anything over a limit is a validation error that names the scene and layer count. Nothing is truncated quietly.

## Cost budget
Each layer has a cost; the scene total must stay under 2500 (warning at 1200).
Plain shape 1; glow/blur/shadow/rGlow +12; clip/mask/isolate/blend +3; path +2; video +30; keyed image +20; keyed video +150; multiplied by count or emit.
Over budget the validator lists the costliest layers and says to put the effect on a group or split the scene.

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
