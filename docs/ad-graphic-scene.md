# Ad vocabulary: `graphic` scene

A data-only scene for code-drawn visuals and animation. It sits in the closed ad vocabulary next to the other scene types, so ads stay free of custom code and the stock player draws everything. Every frame is a pure function of scene time (no wall clock, no CSS animation, randomness is seeded by the scene id), so previews, standalone capture and the MP4/PNG exporters all agree. Two exports of the same project give the same frame fingerprint.

See `docs/ad-graphic-skill.md` for how to use the blocks well. Run `node scripts/ad-review-sheet.mjs --out sheet.png` to render a contact sheet of the demos in `lib/adGraphicDemos.js` (shapes, motion and parenting, particles, a stick fight).

## Layers

`params.layers` is a list of 1 to 48 layers, drawn in order (later layers sit on top). A layer is a plain object; unknown fields are rejected, so raw SVG or code cannot be smuggled in. A scene may expand to at most 200 shapes after `count` and `emit`.

### Shapes and position

| Field | Meaning |
| --- | --- |
| `shape` (required) | `rect`, `circle`, `pill`, `ring`, `polygon`, `star`, `line`, `arc`, `text`, `image` |
| `x`, `y` (required) | Center, -100 to 200. `x` is percent of frame width, `y` percent of frame height. Off-frame is allowed (slide-ins). For a child layer these are offsets from the parent |
| `w` | Percent of frame width. `circle`/`ring`/`polygon`/`star`: size. `arc`: radius. `rect`/`pill`/`image`: width |
| `h` | Percent of frame height (`rect`, `pill`, `image`) |
| `x2`, `y2` | End point of a `line` (required for lines); the line starts at `x`/`y` |
| `thickness` | Percent of frame width: `line`, `ring`, `arc` stroke (0.5 to 20) |
| `sides` | 3 to 12: polygon sides, or star points |
| `text`, `size` | Up to 40 characters; font size as percent of frame width (`text`) |
| `imageId` | Image library id for the `image` shape |
| `color`, `color2` | Palette roles (`accent`, `text`, `muted`, `bg`) or `white`, `black`, `red`, `orange`, `yellow`, `green`, `blue`, `violet`, `pink`. `color2` makes a gradient at `angle` degrees |
| `glow`, `blur` | Percent of frame width (0 to 20) |

An `arc` is the upper half of a circle with `x`/`y` at the middle of its base.

### Transforms

| Field | Meaning |
| --- | --- |
| `rotate` | Degrees, -720 to 720. 0 points right, 90 points down |
| `scale`, `opacity` | Static scale (0.05 to 8) and opacity (0 to 1) |
| `origin` | `center` (default), `top`, `bottom`, `left`, `right`: which point of the shape sits at `x`/`y` and is the pivot for rotation. A pill with `origin: "left"` and `rotate: 90` hangs down from `x`/`y` and swings from its end |

### Motion presets

`motion` is one of `none`, `fade_in`, `slide_up`, `slide_left`, `pop`, `draw` (stroke an arc on, or grow a shape in), `drift`, `twinkle`, `pulse`, `spin`, `swing`, `bob`, `shake`. `delay` (0 to 10 seconds) is when the layer starts.

### Keyframes

`keys` is a list of up to 12 `{ t, x, y, rotate, scale, opacity, ease }`. `t` is seconds after the layer starts. Values are absolute (like the layer's own `x`, `y`, `rotate`, `scale`, `opacity`). A property left out of a key holds its previous value, starting from the layer's own value. `ease` (`linear`, `smooth`, `snappy`, `bounce`) shapes the move into that key. Presets add on top of keyframes.

### Parenting

Give a layer an `id` (lowercase letters, digits, dashes, up to 24 characters). A later layer may set `parent` to that id. The child's `x`/`y` are then offsets from the parent's `x`/`y` in the parent's rotated space, and it moves, rotates and scales with the parent. A parent must come earlier in the list. This is how rigs are built (see the stick fight demo).

### Repeat and spawner (rules)

- `count` (1 to 24) with `stepX`, `stepY`, `stepRotate`, `stepDelay` makes copies of a layer, each shifted by the steps. A `parent` id points at the first copy.
- `emit` (1 to 60) turns the layer into a particle spawner: `emitSpan` seconds to release them, each living `life` seconds, drifting `driftX`/`driftY` percent, with a random start offset up to `spread` percent. The randomness is seeded by the scene id and layer index, so renders are identical.

## Scene-level `hits`

`params.hits` is a list of up to 6 impacts `{ at, shake, flash, freeze, zoom }`, for fight and punch moments.

- `at`: seconds on the animation timeline (the same clock as `delay` and keyframes).
- `freeze`: seconds (0 to 0.5) of hit-stop. All motion pauses, so later `at` and keyframe times shift later by the freeze in real time.
- `shake` (0 to 10, percent of width), `flash` (0 to 1, white), `zoom` (0 to 0.5). All fade quickly after the hit.

## Example: pendulum with a parented bob

```json
{ "id": "swing", "type": "graphic", "duration": 4, "background": "solid", "params": { "layers": [
  { "id": "arm", "shape": "pill", "x": 50, "y": 12, "w": 26, "h": 1.4, "origin": "left", "rotate": 90, "color": "white", "motion": "swing" },
  { "shape": "circle", "parent": "arm", "x": 26, "y": 0, "w": 6, "color": "pink", "glow": 3 }
] } }
```

## Example: rainbow (original layers, still valid)

```json
{
  "id": "bow", "type": "graphic", "duration": 4, "background": "solid",
  "params": { "layers": [
    { "shape": "arc", "x": 50, "y": 60, "w": 40, "thickness": 3, "color": "red", "motion": "draw" },
    { "shape": "arc", "x": 50, "y": 60, "w": 36, "thickness": 3, "color": "orange", "motion": "draw", "delay": 0.2 },
    { "shape": "circle", "x": 18, "y": 66, "w": 14, "color": "white", "motion": "drift" },
    { "shape": "text", "x": 50, "y": 84, "text": "Hello", "size": 9, "color": "text", "motion": "pop", "delay": 1.2 }
  ] }
}
```

## Why a closed list

Vocabulary ads cannot carry custom code. Adding shapes, motions and rules to the registry (and to the player) is the supported way to grow what ads can draw, and every addition ships with validation, tests and a demo.
