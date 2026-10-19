# Using the graphic engine well (notes for Claude and ChatGPT)

What the blocks are for, how to combine them, and what good looks like. The reference for every field is `docs/ad-graphic-scene.md`.

## Workflow

1. Sketch on a grid first: frame is 100 x 100 in percent, x is percent of width, y is percent of height. Landscape (800x450) makes 1 percent of x wider than 1 percent of y; portrait (360x640) the opposite. Shapes that need to look round use `w` only (circle, ring, polygon, star); for pills and rects set both `w` and `h` and check the picture.
2. Build the static layout, then add motion.
3. Render and look before saying it is done: `node scripts/ad-review-sheet.mjs --project ad.json --out sheet.png` (or `--demo fight`). Fix what you see. Do not rely on validation alone; a valid scene can still look wrong.
4. Export with `scripts/export-ad-mp4.mjs` or a still with `scripts/export-ad-still.mjs`.

## Motion that looks good

- Anticipation then action: pull back slightly before a strike, then snap forward with `ease: "snappy"`, then settle with `smooth`.
- Stagger: give repeated layers a `stepDelay` of 0.05 to 0.2 seconds instead of animating them together.
- Overshoot (`bounce`) suits pops and landings; `smooth` suits drifts and camera-like moves. Avoid `linear` except for spins.
- Keep a hold: let important frames rest for 0.2 to 0.4 seconds so the eye can read them.
- Use `glow` sparingly (3 to 6) on the one thing that should draw the eye.

## Rigs (characters and machines)

- A limb is a `pill` with `origin: "left"` at its joint. `rotate` 0 points right, 90 down, -90 up.
- Build chains with `id` and `parent`: torso, then upper arm (parent torso, x at the shoulder along the torso), then forearm (parent upper arm, x at the end of the upper arm). Child rotation is relative to the parent.
- Put the whole body in motion by keyframing the root (position and rotate); limbs follow.
- Define poses as lists of joint angles and keyframe each joint from them. `lib/adGraphicDemos.js` (`figure`, `POSE`) is the worked example, including mirroring a figure to face left (world angle becomes 180 minus angle, relative angles flip sign).
- Depth cue: draw the far limbs in a darker or muted color and earlier in the list.

## Impact (`hits`)

- A hit that reads as a hit: `freeze` 0.06 to 0.12, `shake` 1.5 to 4, `flash` 0.4 to 0.7, `zoom` 0.04 to 0.08. Bigger moments get the bigger numbers, the first hit of a scene the smaller ones.
- Time `at` to the frame where the strike connects, and put a burst (a `star` with scale/opacity keyframes) plus a short `emit` spawner at the contact point on the same time.
- `at` and keyframe times are animation time; the freeze shifts real time, not animation time.

## Particles and repeat

- Sparks: small `circle`, `color` + `color2`, `glow` 2 to 3, `emit` 20 to 60, `life` 0.5 to 1.8, `driftY` negative to rise.
- Confetti: `rect` with a gradient, `emit` 30 to 40, `driftY` positive, wide `spread`.
- Sunburst or radial pattern: one `pill` with `origin: "left"`, `count` 12, `stepRotate` 30.
- Particles are seeded by scene id and layer index, so two scenes with different ids look different but each is repeatable.

## Text, captions and camera

- Captions: `caps`, `weight` 800 to 900, `stroke: "black"` with `strokeW` 0.6 to 1.2, `shadow` 4 to 6, `maxw` 80 to 90, `reveal: "words"` with `revealStep` 0.15 to 0.25. Set `fixed: true` so the camera does not move them. Keep them out of the bottom 8 percent where the concept badge sits.
- Loadout and stat cards: a dark `rect` with `radius` and a thin colored `stroke`, a thin accent `rect` bar on the left, a small muted `caps` label above a bold name, `slide_left` with `delay` steps of 0.25 seconds per row.
- Camera: a slow push (zoom 1 to 1.1 or 1.6 over the scene, focus drifting toward the subject) makes still layouts feel alive. Use `ease: "smooth"`. Fast camera moves need `snappy`.
- Glows and light blobs: `blend: "screen"` with `blur` 6 to 8 and `opacity` 0.4 to 0.6.
- `loop: true` with keyframes gives endless idle motion (slow rotation, breathing).

## Music and beats

- No song yet: set `bpm` and put `react: "beat"` on layers (`rScale` 0.1 to 0.4 for a pulse). Add `beatZoom` 0.02 to 0.04 and `beatShake` 0.2 to 0.5 for a club feel.
- With a song: run `scripts/ad-audio-envelope.mjs`, then use `low` for the kick (big circle, glow, camera), `mid` for the body (bars, text), `high` for sparkle (stars, small particles, `rRot`).
- Equalizer bars: `rect` with `origin: "bottom"`, small `h`, `rStretch` 5 to 9, a `count` of 6 to 8 with `stepX`.
- Reactive amounts are added on top of motion presets and keyframes, so a layer can drift and pulse at once.
- Beat time is real time. A hit's `freeze` does not shift the beat clock or the audio.

## Limits and traps

- 48 layers, 200 expanded shapes (count + emit), 32 keys per layer (`lib/adMotion.js` samples Bezier curves, springs, curved paths, anticipation, follow-through, holds and pose presets into keys), 12 camera keys, 6 hits per scene.
- `thickness` has a floor of 0.5.
- A `line` needs `x2` and `y2`. A child's `x`/`y` and a child line's `x2`/`y2` are offsets from the parent.
- A parent must appear before its children. `parent` on a repeated layer points at the first copy.
- Spawner layers do not draw the base layer, only particles; keyframes on a spawner are ignored.
- Never put statistics, testimonials or claims in a graphic scene; this scene is for visuals. Concept ads must keep `concept: true`.
- No raw SVG, HTML or code in any field. They are rejected.
