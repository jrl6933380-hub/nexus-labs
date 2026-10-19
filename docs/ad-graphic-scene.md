# Ad vocabulary: `graphic` scene

A data-only scene for code-drawn visuals and animation. It sits in the closed ad vocabulary next to the other scene types, so ads stay free of custom code and the stock player draws everything. Every frame is a pure function of scene time (no wall clock, no CSS animation, randomness is seeded by the scene id), so previews, standalone capture and the MP4/PNG exporters all agree. Two exports of the same project give the same frame fingerprint.

See `docs/ad-graphic-skill.md` for how to use the blocks well. Run `node scripts/ad-review-sheet.mjs --out sheet.png` to render a contact sheet of the demos in `lib/adGraphicDemos.js` (shapes, motion and parenting, particles, a stick fight, captions and camera, a loadout card, beat and audio reactive).

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

`keys` is a list of up to 32 `{ t, x, y, rotate, scale, opacity, ease }`. `t` is seconds after the layer starts. Values are absolute (like the layer's own `x`, `y`, `rotate`, `scale`, `opacity`). A property left out of a key holds its previous value, starting from the layer's own value. `ease` (`linear`, `smooth`, `snappy`, `bounce`) shapes the move into that key. Presets add on top of keyframes.

### Parenting

Give a layer an `id` (lowercase letters, digits, dashes, up to 24 characters). A later layer may set `parent` to that id. The child's `x`/`y` are then offsets from the parent's `x`/`y` in the parent's rotated space, and it moves, rotates and scales with the parent. A parent must come earlier in the list. This is how rigs are built (see the stick fight demo).

### Text

| Field | Meaning |
| --- | --- |
| `text` | Up to 90 characters |
| `weight` | 300 to 900 |
| `spacing` | Letter spacing in em (-0.2 to 1) |
| `caps` | Upper-case the text |
| `maxw` | Percent of frame width; wraps lines to that width. `origin: "left"` or `"right"` also left or right aligns |
| `reveal` | `chars` or `words`: units fade and rise in one after another. `revealStep` is seconds between units (default 0.04 for chars, 0.12 for words) |
| `stroke`, `strokeW` | Outline color and width (percent of frame width) |

### Style

- `shadow` (0 to 20): drop shadow on any shape.
- `radius` (percent of width): corner radius for `rect` and `image`.
- `stroke`, `strokeW`: a border on `rect`, `pill`, `circle` and `image`.
- `fit`: `cover` (default) or `contain` for `image`.
- `blend`: `screen`, `multiply` or `overlay` (use `screen` on glows and light blobs).
- `loop: true`: repeats the layer's keyframes after the last key.
- `fixed: true`: the layer ignores the scene camera (captions, logos, HUD). Fixed layers are drawn above world layers. A child follows its parent, so set `fixed` on the root.

### Repeat and spawner (rules)

- `count` (1 to 24) with `stepX`, `stepY`, `stepRotate`, `stepDelay` makes copies of a layer, each shifted by the steps. A `parent` id points at the first copy.
- `emit` (1 to 60) turns the layer into a particle spawner: `emitSpan` seconds to release them, each living `life` seconds, drifting `driftX`/`driftY` percent, with a random start offset up to `spread` percent. The randomness is seeded by the scene id and layer index, so renders are identical.

## Scene-level `camera`

`params.camera` is a list of up to 12 keyframes `{ t, x, y, zoom, rotate, ease }` that move the whole world: `x`/`y` is the point (percent) that sits at the center of the frame (default 50, 50), `zoom` 1 is the full frame (0.3 to 6), `rotate` is -45 to 45 degrees. `t` is animation seconds, `ease` shapes the move into that key, and a property left out of a key holds its last value. Layers with `fixed: true` stay on screen. Hit shake and zoom stack on top of the camera.

## Beat and audio reactivity

Layers can move with a beat clock or with loudness data from real audio. Everything is plain numbers stored in the ad, so a render never reads an audio file and two renders match.

Scene params:

| Field | Meaning |
| --- | --- |
| `bpm` (40 to 240), `beatOffset` (seconds) | Beat clock. The `beat` signal jumps to 1 on each beat and decays quickly |
| `beatZoom` (0 to 0.3), `beatShake` (0 to 5) | Pulse the whole scene on every beat (needs `bpm`) |
| `audioRate` (2 to 60) | Envelope samples per second |
| `audioLow`, `audioMid`, `audioHigh` | Up to 1800 numbers (0 to 100) each: loudness of the bass (under 200 Hz), mids and treble (over 2.5 kHz) |

Layer fields: `react` picks the signal (`beat`, `low`, `mid`, `high`, `level`; `level` is the loudest band, or the beat when there is no audio), and the amounts say what it does at full strength: `rScale` (added to scale), `rStretch` (added to vertical scale only, for equalizer bars with `origin: "bottom"`), `rOpacity`, `rX` and `rY` (percent), `rRot` (degrees), `rGlow` (percent of width, on top of `glow`).

Make the envelopes from a file (needs ffmpeg):

```
node scripts/ad-audio-envelope.mjs --audio song.mp3 --project ad.json --scene bow --out ad-reactive.json
node scripts/export-ad-mp4.mjs --project ad-reactive.json --audio song.mp3 --out ad.mp4
```

Use `--start` and `--duration` to pick the part of the song (30 seconds at most), and the same range when you mux the audio. Without `--project` the script writes just the envelope numbers. Audio analysis lives in `lib/adAudio.js`.

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

## Paths, groups, clips, masks and blends

- `shape: 'path'` draws a Bézier outline from `d`, a list of 2 to 64 segments `{c, x, y, x1, y1, x2, y2}` with `c` one of `M` (move), `L` (line), `Q` (quadratic, uses `x1,y1`), `C` (cubic, uses `x1,y1,x2,y2`), `Z` (close). Coordinates are 0 to 100 inside the layer box (-50 to 150 allowed). `w`/`h` size the box. `fill: 'none'` plus `stroke`/`strokeW` draws an outline, and `motion: 'draw'` traces it.
- `shape: 'group'` is an invisible anchor. Children use `parent` and move, rotate, scale and fade with it.
- `clip` (`rect`, `rounded`, `circle`, `ellipse`) cuts a layer or a group's children to its `w` x `h` box.
- `mask` (`fade_top`, `fade_bottom`, `fade_left`, `fade_right`, `fade_edges`, `spot`) soft-fades the same box.
- `isolate: true` makes the layer its own compositing group, so children's `blend` modes mix only with each other.
- `blend` also accepts `lighten`, `darken`, `color-dodge`, `soft-light`, `hard-light`, `difference`, `exclusion`.

See the `paths` demo in `lib/adGraphicDemos.js`.

## Why a closed list

Vocabulary ads cannot carry custom code. Adding shapes, motions and rules to the registry (and to the player) is the supported way to grow what ads can draw, and every addition ships with validation, tests and a demo.
