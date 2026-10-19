# Ad compositing: capacity and performance budgets

Stage 1 of the compositing workspace. Measured in headless Chromium with software rendering, so a real GPU browser should do better.

## Limits (no silent dropping)
- Layers per graphic scene: 512 (was 48). Expanded shapes (count/emit): 2000 (was 200).
- Anything over a limit is a validation error that names the scene and layer count. Nothing is truncated quietly.

## Cost estimate (advisory)
Each layer has an estimated cost. It never blocks an ad: the only hard limits are 512 layers and 2000 expanded shapes. `listLayers` reports the total and flags it above 1200 so an agent can see where a heavy scene spends its time.
Plain shape 1; glow/blur/shadow/rGlow +12; clip/mask/isolate/blend +3; path +2; video +30; keyed image/video +20; multiplied by count or emit.
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
