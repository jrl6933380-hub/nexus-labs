# Ad vocabulary: `graphic` scene

A data-only scene for code-drawn visuals. It sits in the closed ad vocabulary next to the other scene types, so ads stay free of custom code and the stock player draws everything.

## What a graphic scene is

`params.layers` is a list of 1 to 16 layers. Layers draw in order, so later layers sit on top. Each layer is a plain object. Unknown fields are rejected, so raw SVG or code cannot be smuggled in.

| Field | Meaning |
| --- | --- |
| `shape` (required) | `rect`, `circle`, `pill`, `arc`, `text`, `image` |
| `x`, `y` (required) | Layer center, 0 to 100, as percent of frame width and height |
| `w` | Percent of frame width. For `circle` this is the diameter. For `arc` it is the radius |
| `h` | Percent of frame height (`rect`, `pill`, `image`) |
| `color` | `accent`, `text`, `muted`, `bg` (palette roles) or `white`, `black`, `red`, `orange`, `yellow`, `green`, `blue`, `violet`, `pink` |
| `text` | Up to 40 characters (`text` shape) |
| `size` | Font size as percent of frame width (`text` shape) |
| `thickness` | Stroke as percent of frame width (`arc`) |
| `motion` | `none`, `fade_in`, `slide_up`, `slide_left`, `pop`, `draw`, `drift`, `twinkle`, `pulse` |
| `delay` | Seconds before the layer's motion starts, 0 to 10 |
| `imageId` | Image library id for the `image` shape |

An `arc` is the upper half of a circle. `x`/`y` is the middle of its base. `draw` animates the stroke on.

## Determinism

Every frame is a pure function of scene time, with no CSS animation and no wall clock. Preview, standalone capture and frame export therefore agree.

## Example: rainbow

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

## Why a closed list of shapes

Vocabulary ads cannot carry custom code. Adding shapes and motions to the registry (and to the player) is the supported way to grow what ads can draw, and every addition ships with validation and tests.
