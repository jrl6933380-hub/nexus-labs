# Nexus visual language 1.3: shaped objects and surface maps

`world3d` adds actual geometry and a perspective camera to the existing vocabulary player. Existing `graphic` scenes and saved v2 ads keep their current rendering path. The first release is aimed at product concepts, props, abstract objects and studio shots. It is a foundation for realism, not a photorealistic image/video model.

## From a prompt to a scene

An agent interprets the user's prompt, calls `describe_nexus_ad_vocabulary`, and maps the request into validated scene data. The deterministic constructor does not itself understand arbitrary prose. Start with `create_nexus_ad_from_brief` and `dry_run:true`:

```json
{
  "business_name": "Studio Concept",
  "industry": "other",
  "goal": "visit",
  "visual": "studio3d",
  "subject": "bottle",
  "material": "metal",
  "subject_color": "#49a7c9",
  "lighting": "studio",
  "camera_move": "orbit",
  "length_sec": 6,
  "dry_run": true
}
```

This expands into editable objects, lights and camera keys, followed by a concept end card. No model call, paid generation, external assets or publication occurs. Agent-facing guidance and a complete example are returned by the vocabulary tool.

| Prompt concept | Language |
|---|---|
| Bottle, device, headphones, sculpture | `subject` constructor presets; bottle uses a continuous profile, device uses bevels |
| Rounded device, softened housing | `rounded_box` with `radius` in metres |
| Turned bottle, shaped prop | `lathe` with an editable radius/height `profile` |
| Surface artwork, grain or roughness variation | Library image IDs in `colorMap` / `roughnessMap` |
| Plastic, metal, chrome, ceramic, rubber, stone, wood | Material preset; objects can override `roughness` and `metalness` |
| Studio, warm, dramatic | `lighting` constructor presets, or explicit directional/point lights |
| Orbit, dolly, locked camera | `camera_move`, expanded to `cameraPath` |
| Position, rotate, scale, fade | Time-based object `keys`, sampled from scene time |
| Other objects and assemblies | Agent composes supported `world3d.objects` through `save_nexus_ad_v2` |

Example prompt/brief pairs are in [ad-world3d-examples.json](ad-world3d-examples.json). These are reusable language examples and regression fixtures. We can add inline visual references, specify the desired properties, build the scene, review the render and retain accepted examples. That teaches agents how to use the language; it is not model-weight training.

## Spatial rules

- Units are metres; Y is up. Geometry is centred. A 1m-high box at `y:0.5` rests on the ground plane at `y:0`.
- Shapes: `box`, `rounded_box`, `lathe`, `sphere`, `cylinder`, `cone`, `torus`, `plane`, and a non-drawing `group`. A torus can use `arc` (15–360 degrees) for a partial band. Partial tube ends are open; join them into another part when a visible cap is needed.
- `w/h/d` are geometry dimensions; `x/y/z` are positions; `rx/ry/rz` are degrees. Animated `sx/sy/sz` affect object transforms and their children. Geometry dimensions do not stretch child positions.
- Stable IDs are unique. Parents must precede children. Build complex objects as assemblies rather than claiming an unsupported imported mesh exists.
- `cameraPath` defines a real perspective camera position, look-at target and FOV. Do not also apply a scene-level CSS camera unless that extra screen transform is intended.
- Key times are strictly increasing. Evaluate every frame from scene time; do not accumulate wall-clock simulation state. Existing `lib/adMotion.js` motion-building concepts can inform authored keys, but this release does not add IK, collisions, gravity or character rigs.

## Shape a product

`rounded_box` keeps circular bevels in physical metres even when `w/h/d` differ. `radius` defaults to 15% of the smallest dimension; an explicit radius must be between 0 and 5m and no more than half that dimension. Zero produces the original hard box. Its six faces each have a fixed 10×10 vertex grid. Animating scale can stretch the finished object; use dimensions when authoring a constant physical edge radius.

```json
{"id":"case","shape":"rounded_box","w":0.85,"h":1.6,"d":0.18,"radius":0.065,"y":0.8,"material":"metal","color":"#49a7c9"}
```

`lathe` revolves a profile around Y. A profile has 2–32 `{r,y}` points: radius 0–0.5, height -0.5–0.5, with each height at least 0.0001 above the previous one and at least one positive radius. These are normalized local coordinates: `w/h/d` then scale the mesh. A radius of 0.5 gives the full authored width/depth. Points need not reach either height bound; position the object using its actual lowest profile height.

```json
{"id":"body","shape":"lathe","w":0.7,"h":1.6,"d":0.7,"y":0.8,"material":"ceramic","color":"#eee2ce","profile":[{"r":0.43,"y":-0.5},{"r":0.5,"y":-0.43},{"r":0.5,"y":0.16},{"r":0.37,"y":0.3},{"r":0.19,"y":0.4},{"r":0.19,"y":0.5}]}
```

`profileCurve:"smooth"` (default) uses monotone cubic interpolation, eight subdivisions per profile interval and 40 radial segments. It stays within adjacent radii, including narrow necks. `"linear"` preserves straight profile segments with distinct normals at their boundaries. The maximum smooth profile has 10,293 vertices including caps, within WebGL1's 16-bit index range. `capped` defaults true; false removes both end discs. It does not create interior walls, wall thickness or glass transmission. Heights must increase: folded profiles, horizontal lips and arbitrary extruded shapes are not supported. Shape parameters are static; transform keys remain seekable.

Existing saved primitive scenes keep their geometry. Newly constructed bottle/device concepts use the improved shapes. The language version is 1.2.0; project `specVersion` stays 2. The mesh cache includes dimensions, radius, profile, interpolation and cap settings so two different objects cannot accidentally reuse one mesh.

## Surface maps (1.3)

Use `list_nexus_images` / `save_nexus_image` for uploaded or generated image assets. Reference an owned ID in `colorMap` or `roughnessMap` on a drawing object; groups cannot carry maps. Save/render preflight resolves these IDs in the connected account, and the same collector supplies board previews and every exporter. No URL is accepted as a map. Video data is rejected by the renderer; maps require a PNG, JPEG or WebP image.

```json
{"id":"body","shape":"cylinder","y":0.6,"w":0.7,"h":1.2,"d":0.7,"material":"plastic","color":"#ffffff","colorMap":"img-0123456789","roughnessMap":"img-abcdef0123","roughness":1,"mapProjection":"cylindrical","mapScale":1,"mapOffsetX":0.25}
```

`colorMap` multiplies object colour in linear light after decoding sRGB, so use white for untinted artwork. Existing procedural wood/stone modulation still applies for those material presets. `roughnessMap` uses the red channel as linear data and multiplies the object's roughness (set `roughness:1` for the map's full range). Effective roughness is clamped to 0.05–1. Texture alpha is ignored: object `opacity` remains the alpha control, and mapped objects cast their full geometry shadow. This is surface detail, not cutout decals, transparency or displacement.

`mapProjection` is `box` (default, dominant local-normal face), `cylindrical` (Y axis), `spherical`, or `planar` (XY). These use normalized local object coordinates, so detail follows transforms and seeks. They do not import UVs; face boundaries/poles can show seams or distortion, especially on rounded/torus shapes. `mapScale` (0.125–16) repeats both UV axes; `mapOffsetX/Y` (-16–16) shift them. Wrapping is performed in the shader, with linear filtering and clamp-to-edge textures so non-power-of-two images work in WebGL1. There are no mipmaps or anisotropic filtering; distant/repeated detail may alias.

Up to eight distinct map images per scene. Each is proportionally resized to at most 1024 pixels on its longest side, bounding RGBA texture storage to 32MiB across eight maps (plus the renderer's existing buffers). Images above 16 megapixels are refused after decode; this is not a pre-decode decompression-bomb guard. Data stays in the existing image library; project data stores IDs only. Asset dimensions and import limits remain the image library's existing upload contract.

Captures wait for decode, upload and a redraw of the requested frame. Decode errors, missing/invalid data, oversized decoded images and eight-second decode timeouts are render errors rather than successful white-placeholder exports. Preview redraws on readiness even when paused. Leaving a scene cancels pending loads and deletes its GPU textures. The public data language is 1.3.0; project `specVersion` stays 2. No normal maps, imported meshes, environment reflections, or photorealism guarantee are added.

## Rendering and budgets

- WebGL 1, embedded locally in the sandbox player. No external script loading, network requests or new package dependency. The complete player stays under the existing 100,000-character creative-design cap.
- Perspective, depth buffering, nonuniform-scale normal correction, parent transforms and per-object colour. Shading uses a GGX-style metallic/roughness BRDF, simple hemispheric fill, procedural stone/wood colour variation and an exposure/tone curve. These presets approximate material response; they are not measured/scanned materials.
- Up to 64 objects, 4 lights, 32 transform keys per object and 16 camera keys. Fixed mesh resolutions bound tessellation. The first directional light casts a 512px packed-depth shadow map, filtered over nine taps. `shadowSpan` controls its world-space coverage. Point-light shadows are not implemented.
- Transparent opacity uses back-to-front object sorting and alpha blending, with the usual limitations for intersecting transparent objects. There is no glass refraction or physically correct transmission.
- Capture uses the same player as preview, explicitly completes WebGL work before frame acknowledgement, and retains the drawing buffer. Still/sequence alpha is preserved outside geometry; an authored ground plane stays opaque.
- Leaving a 3D scene disposes buffers, textures, shaders, programs, framebuffer and renderbuffer, then releases its context. Failed/unavailable WebGL and context loss produce render errors; exports must not silently succeed as blank frames.
- 2D layer selection/edit/review packs still cover `graphic` only. For 3D use `edit_nexus_ad` scene params and normal still/evidence/MP4 renders. Dedicated 3D object selection is a later increment.

## Verify

```sh
node scripts/build-ad-player.mjs
node --test test/ad-*.test.mjs
npm run test:ad-world3d -- --out test-results/world3d --chromium /path/to/webgl-capable-chromium
```

The explicit browser suite tests constructor examples, shaped versus primitive renders, distinct profile caching, depth ordering, actual floor shadows, material changes, perspective orbit, seek determinism, context disposal, alpha and preview/still/sequence agreement, then exports and probes a 6-second H.264 MP4. It runs with network access blocked. Software rendering is supported; phone/WebKit performance must be tested separately. See [shaped geometry verification](ad-world3d-shaped-verification.md) for this increment and [foundation verification](ad-world3d-verification.md) for the earlier baseline.

## Next increments

1. More shape families: rounded extrusions, interior walls, horizontal lips and spline paths. Rounded boxes and monotone lathe profiles are now available.
2. Real assets: owned GLB/glTF meshes, imported UVs and normal maps, with upload validation, asset provenance, memory and polygon budgets. Library colour/roughness maps are now supported.
3. Lighting: image-based environments, reflections, improved area lights and shadow quality.
4. Motion: rigged characters, IK/foot planting, contact-aware movement and deterministic physics.
5. Realism evaluation: paired visual references and rendered examples across products, interiors, outdoor scenes and characters. Add accepted examples to fixtures and test capabilities independently.

No production worker deployment is part of this change. Queued connector renders still require the user's deployed worker. Nothing is merged or published automatically.

Implementation references: [WebGL 1 specification](https://registry.khronos.org/webgl/specs/1.0.0/) and [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
