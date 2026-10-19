# Nexus visual language 1.1: a 3D foundation

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
| Bottle, device, headphones, sculpture | `subject` constructor presets, made of primitives |
| Plastic, metal, chrome, ceramic, rubber, stone, wood | Material preset; objects can override `roughness` and `metalness` |
| Studio, warm, dramatic | `lighting` constructor presets, or explicit directional/point lights |
| Orbit, dolly, locked camera | `camera_move`, expanded to `cameraPath` |
| Position, rotate, scale, fade | Time-based object `keys`, sampled from scene time |
| Other objects and assemblies | Agent composes supported `world3d.objects` through `save_nexus_ad_v2` |

Example prompt/brief pairs are in [ad-world3d-examples.json](ad-world3d-examples.json). These are reusable language examples and regression fixtures. We can add inline visual references, specify the desired properties, build the scene, review the render and retain accepted examples. That teaches agents how to use the language; it is not model-weight training.

## Spatial rules

- Units are metres; Y is up. Geometry is centred. A 1m-high box at `y:0.5` rests on the ground plane at `y:0`.
- Shapes: `box`, `sphere`, `cylinder`, `cone`, `torus`, `plane`, and a non-drawing `group`. A torus can use `arc` (15–360 degrees) for a partial band. Partial tube ends are open; join them into another part when a visible cap is needed.
- `w/h/d` are geometry dimensions; `x/y/z` are positions; `rx/ry/rz` are degrees. Animated `sx/sy/sz` affect object transforms and their children. Geometry dimensions do not stretch child positions.
- Stable IDs are unique. Parents must precede children. Build complex objects as assemblies rather than claiming an unsupported imported mesh exists.
- `cameraPath` defines a real perspective camera position, look-at target and FOV. Do not also apply a scene-level CSS camera unless that extra screen transform is intended.
- Key times are strictly increasing. Evaluate every frame from scene time; do not accumulate wall-clock simulation state. Existing `lib/adMotion.js` motion-building concepts can inform authored keys, but this release does not add IK, collisions, gravity or character rigs.

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

The explicit browser suite tests constructor examples, depth ordering, actual floor shadows, material changes, perspective orbit, seek determinism, context disposal, alpha and preview/still/sequence agreement, then exports and probes a 6-second H.264 MP4. It runs with network access blocked. Software rendering is supported; phone/WebKit performance must be tested separately. See [verification and visual evidence](ad-world3d-verification.md) for the measured environment and pass/fail results.

## Next increments

1. Better shapes: rounded/extruded profiles, lathe/curve geometry and bevels for convincing product edges.
2. Real assets: owned GLB/glTF meshes and texture maps, with upload validation, asset provenance, memory and polygon budgets.
3. Lighting: image-based environments, reflections, improved area lights and shadow quality.
4. Motion: rigged characters, IK/foot planting, contact-aware movement and deterministic physics.
5. Realism evaluation: paired visual references and rendered examples across products, interiors, outdoor scenes and characters. Add accepted examples to fixtures and test capabilities independently.

No production worker deployment is part of this change. Queued connector renders still require the user's deployed worker. Nothing is merged or published automatically.

Implementation references: [WebGL 1 specification](https://registry.khronos.org/webgl/specs/1.0.0/) and [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
