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

## Mattes, crops and reveals (stage 3b)
Any box layer (image, video, rect, circle, pill, ring, polygon, star) or group can carry:
- `matte`: a polygon `[{x,y},...]` in percent of the layer's own box (extra polygons use a `g` number 0-7, 3+ points each). `matteMode: keep` shows only inside (a garbage matte for footage); `cut` hides inside (a holdout, or a hole to see through). `matteFeather` (0-20, percent of the box) softens the edge.
- `matteImage`: an uploaded image used as the matte. `matteChannel: luma` (white shows, default) or `alpha` (its transparency). A missing matte image hides the layer and fails the render with a message naming the layer and the image id; it never renders the layer unmasked by accident.
- Mattes, `clip` and `mask` combine: a pixel shows only if every one allows it. A matte on a group masks all its children, so masks nest through parents.
- Keyframes can animate `cropL/cropT/cropR/cropB` (0-100, image and video layers, including keyed ones) and `mx/my` (matte polygon offset, percent of the box) and `ms` (matte scale), so a matte can follow a moving subject. All keyframes (up to 32) are kept; the player used to read only the first 12.
- Rendering is an SVG/CSS mask, so preview and export are the same pixels, and the matte is a pure function of scene time: a random seek equals sequential playback (checked at six times in forward, reverse and shuffled order).
- Helpers in `lib/adLayers.js`: `setMatte`, `clearMatte`, `revealWipe` (reveal or hide from any edge; crop keys for pictures, a sliding matte for shapes and groups).
- `lib/adSeparability.js` `separabilityReport(png)`: from the pixels, says whether an upload already has alpha, has a flat backdrop a key can remove (and which key mode and color), or needs a supplied matte, a hand-drawn polygon, manual work or an optional segmentation model. It never claims hidden content can be recovered.

Limits: a polygon is straight-edged (curves need more points); `matteFeather` is a blur in box percent so it is slightly elliptical on non-square layers; a matte image is stretched to the layer box; text, line and arc layers have no box and take no matte (wrap them in a group).

## Agent tools, transparent stills and image sequences (stage 4)
Claude, ChatGPT and Nex use the same connector tools; none of them can do anything the others cannot.
- `read_nexus_layers`: graphic scenes, then a scene's layers (stable id, name, role, shape, parent, keyed/matted/animated, hash), one layer in full, or a find by name, role, shape, color, image or parent.
- `edit_nexus_layers`: up to 20 ordered operations in one scene (patch, add, group, ungroup, reorder, remove, duplicate, replace_asset, set_key/clear_key, set_matte/set_matte_image/clear_matte, reveal_wipe). Atomic: if one fails nothing is saved and the error names the operation number. The ad baseline (or a per-layer hash on `patch`) refuses edits made against stale state; `dry_run` previews. Layers without ids get ids on the first edit. Code: `lib/adLayerTools.js`.
- `render_nexus_ad` kinds: `still` and `sequence` accept `transparent:true` (real alpha, no background; a concept ad keeps its badge). `sequence` writes numbered PNG frames plus `sequence.manifest.json` (per-frame time and sha256, project hash), at most 240 frames, fps 24/30/60; the range is checked before the job is queued. `layers` renders a review pack for one graphic-scene moment: final, selection map plus legend, and original/foreground/matte views of up to 4 keyed layers, with a labelled `sheet.png`.
- `view_nexus_ad_layers` returns the sheet (and any named views) as images the model can see, plus the selection legend. `check_nexus_image_separability` runs the separability report on a library PNG.
- Preview and export share one player; `?transparent=1` only removes the background fill and the page/stage fill.

Limits: the render worker is not deployed here, so queued jobs need a worker with Chromium; JPEG uploads must be converted to PNG for the separability check; a sequence is capped at 240 frames (use MP4 beyond that); antialiased edge pixels in the selection map count toward no layer.
