// Demo projects for the graphic engine. They are plain vocabulary (v2) data, validated by the tests and
// rendered by scripts/ad-review-sheet.mjs, so they double as living documentation and regression fixtures.
// `shots` are the scene times (ms) the review sheet captures for each demo.

const base = (name, format, scenes, extra = {}) => ({
  specVersion: 2, name, mood: 'bold', palette: 'ocean-blue', concept: true,
  platform: { format, lengthSec: 15 },
  scenes: [...scenes, { id: 'end', type: 'end_card', duration: 2, params: { cta: 'Built in code', tagline: 'Nexus graphic engine' }, background: 'orbits' }],
  ...extra,
});

// ---- 1. shapes gallery ------------------------------------------------------------------------------
const shapes = base('Shapes gallery', 'square', [{
  id: 'gallery', type: 'graphic', duration: 4, background: 'grid',
  params: {
    layers: [
      { shape: 'rect', x: 20, y: 22, w: 20, h: 16, color: 'red', color2: 'orange', angle: 135, motion: 'pop', delay: 0.1 },
      { shape: 'circle', x: 50, y: 22, w: 16, color: 'blue', glow: 4, motion: 'pop', delay: 0.25 },
      { shape: 'pill', x: 80, y: 22, w: 22, h: 6, color: 'green', color2: 'yellow', angle: 90, motion: 'pop', delay: 0.4 },
      { shape: 'ring', x: 20, y: 52, w: 16, thickness: 2, color: 'pink', motion: 'pulse', delay: 0.55 },
      { shape: 'polygon', x: 50, y: 52, w: 16, sides: 6, color: 'violet', color2: 'blue', angle: 180, motion: 'pop', delay: 0.7 },
      { shape: 'star', x: 80, y: 52, w: 18, sides: 5, color: 'yellow', glow: 5, motion: 'twinkle', delay: 0.85 },
      { shape: 'line', x: 10, y: 80, x2: 36, y2: 70, thickness: 1.2, color: 'white', motion: 'fade_in', delay: 1 },
      { shape: 'arc', x: 50, y: 82, w: 10, thickness: 2.5, color: 'orange', motion: 'draw', delay: 1.15 },
      { shape: 'text', x: 80, y: 78, text: 'Aa', size: 14, color: 'accent', motion: 'bob', delay: 1.3 },
    ],
  },
}]);

// ---- 2. motion: keyframes, spin, swing, parenting --------------------------------------------------
const motion = base('Motion and parenting', 'landscape', [{
  id: 'motion', type: 'graphic', duration: 5, background: 'gradient',
  params: {
    layers: [
      // Keyframed bouncing ball (y moves, x travels). Times are seconds after the layer starts.
      { shape: 'circle', x: 10, y: 20, w: 7, color: 'orange', glow: 3, keys: [
        { t: 0.5, y: 75, x: 14, ease: 'bounce' }, { t: 1, y: 22, x: 18, ease: 'smooth' },
        { t: 1.5, y: 75, x: 22, ease: 'bounce' }, { t: 2, y: 28, x: 26, ease: 'smooth' },
        { t: 2.5, y: 75, x: 30, ease: 'bounce' }, { t: 3, y: 38, x: 34, ease: 'smooth' } ] },
      { shape: 'line', x: 4, y: 82, x2: 40, y2: 82, thickness: 0.5, color: 'muted' },
      // Pendulum: an arm that swings from its end, with a bob parented to the arm tip.
      { id: 'arm', shape: 'pill', x: 58, y: 12, w: 26, h: 1.4, origin: 'left', rotate: 90, color: 'white', motion: 'swing', delay: 0.2 },
      { shape: 'circle', parent: 'arm', x: 26, y: 0, w: 6, color: 'pink', glow: 3 },
      // A spinning pivot with a moon parented to it: the moon orbits as the pivot turns.
      { shape: 'ring', x: 84, y: 55, w: 24, thickness: 0.5, color: 'muted' },
      { id: 'pivot', shape: 'circle', x: 84, y: 55, w: 3, color: 'yellow', glow: 4, motion: 'spin' },
      { shape: 'circle', parent: 'pivot', x: 12, y: 0, w: 3.5, color: 'blue' },
      // Star that fades in with a keyframed scale and spin.
      { shape: 'star', x: 62, y: 72, w: 12, sides: 5, color: 'yellow', color2: 'orange', keys: [
        { t: 0, scale: 0.1, opacity: 0, rotate: -90 }, { t: 1, scale: 1.2, opacity: 1, rotate: 0, ease: 'bounce' }, { t: 2, scale: 1, rotate: 20, ease: 'smooth' } ], delay: 1 },
    ],
  },
}]);

// ---- 3. particles and repeat -----------------------------------------------------------------------
const particles = base('Particles and repeat', 'portrait', [{
  id: 'fx', type: 'graphic', duration: 5, background: 'solid',
  params: {
    layers: [
      // Sunburst: twelve copies of one ray, each turned 30 degrees.
      { shape: 'pill', x: 50, y: 38, w: 22, h: 0.9, origin: 'left', color: 'yellow', color2: 'orange', count: 12, stepRotate: 30, motion: 'pulse', delay: 0.1 },
      { shape: 'circle', x: 50, y: 38, w: 14, color: 'yellow', glow: 6, motion: 'pop', delay: 0.1 },
      // Fountain of sparks, seeded by the scene id so it is the same on every render.
      { shape: 'circle', x: 50, y: 82, w: 4, color: 'orange', color2: 'yellow', emit: 60, emitSpan: 3.5, life: 1.8, driftY: -48, spread: 16, glow: 3, delay: 0.5 },
      // Confetti drifting down.
      { shape: 'rect', x: 50, y: 4, w: 4, h: 1.8, color: 'pink', color2: 'violet', emit: 40, emitSpan: 3.5, life: 2.4, driftY: 80, driftX: 6, spread: 90, delay: 0.8 },
      { shape: 'text', x: 50, y: 60, text: 'Seeded', size: 11, color: 'text', motion: 'pop', delay: 0.6 },
    ],
  },
}]);

// ---- 4. fight: two stick figures built from parented limbs, with hit effects ------------------------
// A pose lists world angles in degrees for a figure facing right (0 = right, 90 = down). The generator turns
// them into per-joint relative rotations (mirroring for a figure facing left) as keyframes on parented limbs.
const POSE = {
  guard: { lean: 6, uf: 35, ff: -70, ub: 55, fb: -80, tf: 72, sf: 95, tb: 108, sb: 88 },
  windup: { lean: -4, uf: 100, ff: 160, ub: 55, fb: -80, tf: 80, sf: 98, tb: 112, sb: 90 },
  punch: { lean: 22, uf: 5, ff: 0, ub: 70, fb: -70, tf: 55, sf: 85, tb: 125, sb: 100, dx: 5 },
  hit: { lean: -24, uf: 80, ff: 115, ub: 105, fb: 135, tf: 85, sf: 100, tb: 95, sb: 90, dx: -4 },
  kneeUp: { lean: 0, uf: 55, ff: -75, ub: 85, fb: -60, tf: 35, sf: 85, tb: 100, sb: 92, dx: 1 },
  kick: { lean: -22, uf: 60, ff: -20, ub: 125, fb: 165, tf: -12, sf: -6, tb: 100, sb: 95, dx: 8 },
  fallen: { lean: -86, uf: 165, ff: 200, ub: 150, fb: 190, tf: 12, sf: 6, tb: 24, sb: 14, dx: -10, dy: 17 },
};

const norm = (a) => { let v = a; while (v > 180) v -= 360; while (v <= -180) v += 360; return Math.round(v * 100) / 100; };

function figure(id, x, y, dir, color, back, timeline) {
  const world = (a) => (dir === 1 ? a : 180 - a);
  const keysFor = (pick, parentPick) => timeline.map(([t, pose, ease]) => {
    const P = POSE[pose];
    return { t, rotate: norm(world(pick(P)) - (parentPick ? world(parentPick(P)) : 0)), ...(ease ? { ease } : {}) };
  });
  const torsoWorld = (P) => -90 + dir * P.lean;
  const torsoKeys = timeline.map(([t, pose, ease]) => {
    const P = POSE[pose];
    return { t, rotate: norm(torsoWorld(P)), x: Math.round((x + dir * (P.dx || 0)) * 100) / 100, y: y + (P.dy || 0), ...(ease ? { ease } : {}) };
  });
  const rel = (pick, parent) => keysFor(pick, parent);
  // Relative joint angle = child world - parent world. Torso world uses dir*lean, so build it explicitly.
  const keysRelTorso = (pick) => timeline.map(([t, pose, ease]) => {
    const P = POSE[pose];
    return { t, rotate: norm(world(pick(P)) - torsoWorld(P)), ...(ease ? { ease } : {}) };
  });
  const first = POSE[timeline[0][1]];
  const L = (o) => ({ ...o });
  return [
    L({ id: `${id}-t`, shape: 'pill', x, y, w: 10, h: 2.2, origin: 'left', color, rotate: norm(torsoWorld(first)), keys: torsoKeys }),
    L({ id: `${id}-h`, shape: 'circle', parent: `${id}-t`, x: 12, y: 0, w: 3.4, color }),
    L({ id: `${id}-ub`, shape: 'pill', parent: `${id}-t`, x: 8.8, y: 0, w: 5, h: 1.8, origin: 'left', color: back, rotate: keysRelTorso((P) => P.ub)[0].rotate, keys: keysRelTorso((P) => P.ub) }),
    L({ id: `${id}-fb`, shape: 'pill', parent: `${id}-ub`, x: 5, y: 0, w: 4.6, h: 1.8, origin: 'left', color: back, rotate: rel((P) => P.fb, (P) => P.ub)[0].rotate, keys: rel((P) => P.fb, (P) => P.ub) }),
    L({ id: `${id}-tb`, shape: 'pill', parent: `${id}-t`, x: 0, y: 0, w: 6, h: 2, origin: 'left', color: back, rotate: keysRelTorso((P) => P.tb)[0].rotate, keys: keysRelTorso((P) => P.tb) }),
    L({ id: `${id}-sb`, shape: 'pill', parent: `${id}-tb`, x: 6, y: 0, w: 6, h: 1.8, origin: 'left', color: back, rotate: rel((P) => P.sb, (P) => P.tb)[0].rotate, keys: rel((P) => P.sb, (P) => P.tb) }),
    L({ id: `${id}-tf`, shape: 'pill', parent: `${id}-t`, x: 0, y: 0, w: 6, h: 2, origin: 'left', color, rotate: keysRelTorso((P) => P.tf)[0].rotate, keys: keysRelTorso((P) => P.tf) }),
    L({ id: `${id}-sf`, shape: 'pill', parent: `${id}-tf`, x: 6, y: 0, w: 6, h: 1.8, origin: 'left', color, rotate: rel((P) => P.sf, (P) => P.tf)[0].rotate, keys: rel((P) => P.sf, (P) => P.tf) }),
    L({ id: `${id}-uf`, shape: 'pill', parent: `${id}-t`, x: 8.8, y: 0, w: 5, h: 1.8, origin: 'left', color, rotate: keysRelTorso((P) => P.uf)[0].rotate, keys: keysRelTorso((P) => P.uf) }),
    L({ id: `${id}-ff`, shape: 'pill', parent: `${id}-uf`, x: 5, y: 0, w: 4.6, h: 1.8, origin: 'left', color, rotate: rel((P) => P.ff, (P) => P.uf)[0].rotate, keys: rel((P) => P.ff, (P) => P.uf) }),
  ];
}

const burst = (x, y, t) => ({
  shape: 'star', x, y, w: 11, sides: 8, color: 'yellow', color2: 'orange', glow: 5, delay: t, opacity: 0, keys: [
    { t: 0, scale: 0.2, opacity: 1 }, { t: 0.16, scale: 1.25, opacity: 1, ease: 'snappy' }, { t: 0.45, scale: 1.6, opacity: 0, ease: 'smooth' } ],
});

const fight = base('Stick fight', 'landscape', [{
  id: 'fight', type: 'graphic', duration: 5.5, background: 'solid',
  params: {
    layers: [
      { shape: 'circle', x: 50, y: 48, w: 46, color: 'violet', color2: 'bg', angle: 180, blur: 6, opacity: 0.4 },
      { shape: 'line', x: 4, y: 89, x2: 96, y2: 89, thickness: 0.5, color: 'muted' },
      ...figure('a', 41, 68, 1, 'white', 'muted', [
        [0, 'guard'], [0.85, 'guard', 'smooth'], [1.0, 'windup', 'smooth'], [1.12, 'punch', 'snappy'], [1.4, 'punch'], [1.95, 'guard', 'smooth'],
        [2.7, 'guard'], [2.8, 'hit', 'snappy'], [3.0, 'hit'], [3.7, 'fallen', 'smooth'],
      ]),
      ...figure('b', 59, 68, -1, 'orange', 'yellow', [
        [0, 'guard'], [1.12, 'guard'], [1.2, 'hit', 'snappy'], [1.6, 'hit'], [2.25, 'guard', 'smooth'],
        [2.5, 'kneeUp', 'smooth'], [2.8, 'kick', 'snappy'], [3.1, 'kick'], [3.7, 'guard', 'smooth'],
      ]),
      { ...burst(49.5, 54, 1.12) },
      { ...burst(41.5, 58, 2.8) },
      { shape: 'circle', x: 49.5, y: 54, w: 1.4, color: 'yellow', emit: 14, emitSpan: 0.1, life: 0.5, spread: 6, driftX: 12, driftY: -14, glow: 2, delay: 1.12 },
      { shape: 'circle', x: 41.5, y: 58, w: 1.6, color: 'orange', emit: 18, emitSpan: 0.1, life: 0.6, spread: 7, driftX: -14, driftY: -16, glow: 2, delay: 2.8 },
      { shape: 'text', x: 50, y: 22, text: 'K.O.', size: 16, color: 'red', glow: 4, motion: 'pop', delay: 3.5, keys: [
        { t: 0, scale: 0.2 }, { t: 0.3, scale: 1.25, ease: 'bounce' }, { t: 0.6, scale: 1, ease: 'smooth' } ] },
    ],
    hits: [
      { at: 1.12, shake: 1.6, flash: 0.45, freeze: 0.07, zoom: 0.04 },
      { at: 2.8, shake: 3, flash: 0.7, freeze: 0.12, zoom: 0.08 },
    ],
  },
}]);

// ---- 5. captions: kinetic text, camera, fixed layers ----------------------------------------------
const captions = base('Captions and camera', 'portrait', [{
  id: 'caps', type: 'graphic', duration: 5, background: 'gradient',
  params: {
    layers: [
      // World layers move with the camera.
      { shape: 'circle', x: 50, y: 40, w: 60, color: 'violet', color2: 'blue', angle: 160, blur: 6, blend: 'screen', opacity: 0.55 },
      { shape: 'ring', x: 50, y: 40, w: 46, thickness: 0.8, color: 'white', opacity: 0.6, loop: true, keys: [
        { t: 0, scale: 0.9 }, { t: 2, scale: 1.1, ease: 'smooth' }, { t: 4, scale: 0.9, ease: 'smooth' } ] },
      { shape: 'star', x: 20, y: 24, w: 7, color: 'yellow', glow: 3, count: 4, stepX: 20, stepY: 9, stepDelay: 0.15, motion: 'twinkle' },
      { shape: 'polygon', x: 50, y: 40, w: 22, sides: 6, color: 'pink', color2: 'orange', angle: 135, glow: 4, shadow: 6, motion: 'spin' },
      // Fixed layers stay put while the camera pushes in.
      { shape: 'pill', x: 50, y: 7, w: 36, h: 4.6, color: 'black', opacity: 0.55, stroke: 'white', strokeW: 0.3, fixed: true },
      { shape: 'text', x: 50, y: 7, text: 'NEXUS GRAPHIC', size: 4.2, weight: 800, spacing: 0.12, color: 'white', fixed: true },
      { shape: 'text', x: 50, y: 68, text: 'This engine can do captions', size: 10, weight: 900, caps: true, maxw: 86, reveal: 'words', revealStep: 0.22,
        color: 'white', stroke: 'black', strokeW: 1.1, shadow: 6, fixed: true, delay: 0.4 },
      { shape: 'text', x: 50, y: 82, text: 'letter by letter too', size: 6, weight: 700, reveal: 'chars', revealStep: 0.05,
        color: 'yellow', stroke: 'black', strokeW: 0.6, shadow: 4, fixed: true, delay: 2 },
    ],
    camera: [
      { t: 0, zoom: 1, x: 50, y: 50 },
      { t: 4.5, zoom: 1.6, x: 60, y: 36, ease: 'smooth' },
    ],
  },
}]);

// ---- 6. loadout card: panel, rows, accent bars, push-in ---------------------------------------------
const slot = (i, label, name, color, delay) => [
  { shape: 'rect', x: 33, y: 33 + i * 14.5, w: 46, h: 12.5, radius: 1, color: 'black', opacity: 0.5, stroke: color, strokeW: 0.25, motion: 'slide_left', delay },
  { shape: 'rect', x: 10.4, y: 33 + i * 14.5, w: 1, h: 12.5, color, glow: 2, motion: 'slide_left', delay },
  { shape: 'text', x: 13, y: 29.2 + i * 14.5, text: label, size: 1.9, weight: 700, spacing: 0.18, color: 'muted', origin: 'left', caps: true, motion: 'fade_in', delay: delay + 0.15 },
  { shape: 'text', x: 13, y: 34.8 + i * 14.5, text: name, size: 3.6, weight: 900, caps: true, color: 'white', origin: 'left', reveal: 'chars', revealStep: 0.025, shadow: 3, delay: delay + 0.2 },
];
const loadout = base('Loadout card', 'landscape', [{
  id: 'load', type: 'graphic', duration: 5, background: 'grid',
  params: {
    layers: [
      { shape: 'circle', x: 78, y: 50, w: 36, color: 'orange', color2: 'red', angle: 120, blur: 8, blend: 'screen', opacity: 0.45 },
      { shape: 'polygon', x: 78, y: 50, w: 30, sides: 6, color: 'white', opacity: 0.12, loop: true, keys: [
        { t: 0, rotate: 0 }, { t: 6, rotate: 360, ease: 'linear' } ] },
      { shape: 'text', x: 10, y: 14, text: 'Loadout', size: 8, weight: 900, caps: true, spacing: 0.04, color: 'white', origin: 'left',
        stroke: 'black', strokeW: 0.5, shadow: 5, reveal: 'chars', revealStep: 0.045, delay: 0.1 },
      { shape: 'rect', x: 10, y: 21.5, w: 24, h: 0.9, color: 'orange', color2: 'yellow', angle: 90, origin: 'left', glow: 2, motion: 'draw', delay: 0.5 },
      ...slot(0, 'Primary', 'VX-9 Rifle', 'orange', 0.6),
      ...slot(1, 'Optic', 'Hawk Reflex', 'yellow', 0.85),
      ...slot(2, 'Muzzle', 'Silent Brake', 'green', 1.1),
      ...slot(3, 'Perk', 'Ghost Step', 'blue', 1.35),
      { shape: 'text', x: 88, y: 88, text: 'S-TIER', size: 3.4, weight: 900, spacing: 0.2, color: 'yellow', stroke: 'black', strokeW: 0.4,
        fixed: true, motion: 'pop', delay: 2.2 },
    ],
    camera: [
      { t: 0, zoom: 1, x: 50, y: 50 },
      { t: 4.8, zoom: 1.12, x: 46, y: 48, ease: 'smooth' },
    ],
  },
}]);

// ---- 7. pulse: beat clock and audio envelopes -------------------------------------------------------
// A synthetic 120 bpm track stands in for real analysis (scripts/ad-audio-envelope.mjs makes the same shape of data
// from an audio file): a kick on every beat (low), an off-beat synth stab (mid) and 16th-note hats (high).
const SYNTH_RATE = 20;
const synth = (fn) => Array.from({ length: 5 * SYNTH_RATE }, (_, i) => Math.max(0, Math.min(100, Math.round(fn(i / SYNTH_RATE)))));
const beatPhase = (t, beat) => { const p = t / beat; return p - Math.floor(p); };
const audioLow = synth((t) => 100 * Math.exp(-beatPhase(t, 0.5) * 6));
const audioMid = synth((t) => (beatPhase(t - 0.25, 0.5) < 0.5 ? 70 * Math.exp(-beatPhase(t - 0.25, 0.5) * 5) * (Math.floor((t - 0.25) / 0.5) % 2 ? 1 : 0.6) : 0));
const audioHigh = synth((t) => 60 * Math.exp(-beatPhase(t, 0.125) * 9) * (Math.floor(t / 0.125) % 2 ? 0.55 : 1));
const bars = (react, x, color, color2) => ({ shape: 'rect', x, y: 88, w: 2.6, h: 4, origin: 'bottom', color, color2, angle: 0, react, rStretch: 7, count: 6, stepX: 4.2, delay: 0.1, motion: 'fade_in' });
const pulse = base('Beat and audio reactive', 'landscape', [{
  id: 'pulse', type: 'graphic', duration: 5, background: 'gradient',
  params: {
    bpm: 120, beatZoom: 0.025, beatShake: 0.25,
    audioRate: SYNTH_RATE, audioLow, audioMid, audioHigh,
    layers: [
      { shape: 'circle', x: 50, y: 42, w: 38, color: 'violet', color2: 'pink', angle: 150, blur: 7, blend: 'screen', opacity: 0.5, react: 'low', rScale: 0.22, rOpacity: 0.4 },
      { shape: 'circle', x: 50, y: 42, w: 17, color: 'orange', color2: 'yellow', angle: 90, glow: 2, react: 'low', rScale: 0.4, rGlow: 6 },
      { shape: 'ring', x: 50, y: 42, w: 30, thickness: 0.6, color: 'white', opacity: 0.5, react: 'beat', rScale: 0.3, rOpacity: -0.35 },
      { shape: 'star', x: 18, y: 30, w: 6, color: 'yellow', glow: 2, react: 'high', rRot: 40, rScale: 0.7, count: 3, stepX: 5, stepY: 10 },
      { shape: 'star', x: 82, y: 30, w: 6, color: 'pink', glow: 2, react: 'high', rRot: -40, rScale: 0.7, count: 3, stepX: -5, stepY: 10 },
      bars('low', 7, 'orange', 'red'),
      bars('mid', 38, 'yellow', 'orange'),
      bars('high', 68, 'blue', 'violet'),
      { shape: 'text', x: 50, y: 10, text: 'Audio reactive', size: 6, weight: 900, caps: true, color: 'white', stroke: 'black', strokeW: 0.5, shadow: 4, fixed: true, react: 'beat', rScale: 0.06 },
    ],
  },
}]);

export const GRAPHIC_DEMOS = {
  shapes: { title: 'Shapes gallery', project: shapes, shots: [200, 1500, 3600] },
  motion: { title: 'Motion and parenting', project: motion, shots: [800, 2200, 4400] },
  particles: { title: 'Particles and repeat', project: particles, shots: [600, 2200, 4200] },
  fight: { title: 'Stick fight', project: fight, shots: [700, 1200, 2000, 2950, 3900, 5000] },
  captions: { title: 'Captions and camera', project: captions, shots: [500, 1400, 2600, 4200] },
  loadout: { title: 'Loadout card', project: loadout, shots: [500, 1300, 2400, 4600] },
  pulse: { title: 'Beat and audio reactive', project: pulse, shots: [640, 760, 1010, 1140, 2010, 3250] },
};
