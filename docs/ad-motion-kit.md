# Motion kit (`lib/adMotionKit.js`)

The graphic scene (`docs/ad-graphic-scene.md`) is a low-level vocabulary: shapes, keyframes, camera, particles. The motion kit sits on top of it so an agent can describe a video instead of placing layers by hand. Everything it returns is plain v2 vocabulary data, checked by the strict validator; no code reaches the player.

## One call

```js
import { promoVideo } from './lib/adMotionKit.js';
const project = promoVideo({
  brand: 'Nexus', hook: 'Build your next idea',
  points: [{ title: 'Describe it', sub: 'Plain words, no code' }, 'Watch it build', 'Ship it'],   // up to 4
  stat: { value: '60s', label: 'idea to video' },                                              // optional
  tagline: 'Your personal creative studio', cta: 'Try Nexus',
  style: 'bright',   // bright | warm | cool
  format: 'portrait', // portrait | square | landscape
  bpm: 92,            // optional: scenes pulse on the beat of a beat from lib/adBeat.js
});
```

Scenes: `hook`, `points` (optional), `stat` (optional), `brand` (logo reveal), `end` (end card). Scene transitions and a slow push-in are set for you. Text is cut to the vocabulary limits instead of failing. Output is deterministic. `concept` defaults to true, so the player's "Concept preview" badge is baked into exports as usual.

## Building blocks

Each returns an array of layers to drop into any graphic scene: `glowBlobs`, `kineticTitle`, `burst`, `logoReveal`, `cardStack`, `statPop`, `lowerThird`, `caption` (pass real word times to sync it to speech). They stay well inside the 48-layer and 200-shape limits.

## Rendering

```
node scripts/export-ad-mp4.mjs --project ad.json --audio beat.wav --out promo.mp4
```

A 17 s portrait promo at 30 fps and scale 1 rendered in about 37 s on a 2-CPU machine (see `docs/ad-export.md`).

## Tests

`node --test test/ad-motion-kit.test.mjs`
