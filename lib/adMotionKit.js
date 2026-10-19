// Motion kit for the graphic scene: ready-made layer groups and a one-call promo video, so an agent can describe a
// video ("hook, three points, a stat, a call to action") instead of hand-placing dozens of layers. Everything here is
// plain vocabulary (v2) data: no custom code reaches the player, and the result is checked by the strict validator.
//
//   import { promoVideo, kineticTitle, cardStack } from './adMotionKit.js';
//   const project = promoVideo({ brand: 'Nexus', hook: 'Build your next idea', points: ['Describe it', 'Watch it build', 'Ship it'], cta: 'Try Nexus' });
//
// Coordinates are percent of the frame (portrait 9:16 by default). Delays are seconds from the start of the scene.
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cut = (s, n) => [...String(s ?? '')].slice(0, n).join('');
const fail = (m) => Object.assign(new Error(m), { status: 400, code: 'MOTION_KIT_INVALID' });

/** Two soft light blobs that drift and breathe behind everything else. */
export function glowBlobs({ y = 40, w = 64, a = 'violet', b = 'blue', delay = 0 } = {}) {
  return [
    { shape: 'circle', x: 50, y, w, color: a, color2: b, angle: 150, blur: 7, blend: 'screen', opacity: 0.5, delay,
      keys: [{ t: 0, scale: 0.9 }, { t: 3, scale: 1.08, ease: 'smooth' }, { t: 6, scale: 0.9, ease: 'smooth' }], loop: true },
    { shape: 'circle', x: 78, y: r2(y + 22), w: r2(w * 0.5), color: b, color2: a, angle: 40, blur: 6, blend: 'screen', opacity: 0.35, delay,
      keys: [{ t: 0, x: 78, y: r2(y + 22) }, { t: 4, x: 70, y: r2(y + 16), ease: 'smooth' }, { t: 8, x: 78, y: r2(y + 22), ease: 'smooth' }], loop: true },
  ];
}

/** A headline that arrives word by word, outlined so it reads over any background. */
export function kineticTitle({ text, y = 50, size = 10, color = 'white', delay = 0.2, step = 0.16, maxw = 86 } = {}) {
  return [{ shape: 'text', x: 50, y, text: cut(text, 90), size, weight: 900, caps: true, maxw, color, stroke: 'black', strokeW: 1.1, shadow: 6,
    reveal: 'words', revealStep: step, delay, fixed: true }];
}

/** A short burst of sparkles, for the moment something lands. */
export function burst({ x = 50, y = 40, color = 'yellow', count = 24, delay = 0 } = {}) {
  return [{ shape: 'star', x, y, w: 3.2, sides: 4, color, glow: 2, emit: clamp(Math.round(count), 1, 60), emitSpan: 0.35, life: 1, driftY: -14, driftX: 0, spread: 18, delay }];
}

/** The brand mark: a rounded tile pops in, a ring bursts out of it, sparkles follow. */
export function logoReveal({ letter = 'N', x = 50, y = 38, size = 22, color = 'accent', delay = 0 } = {}) {
  const l = [...String(letter || 'N').trim()][0]?.toUpperCase() || 'N';  // one letter: the tile is a mark, not a word
  return [
    { shape: 'ring', x, y, w: size * 1.1, thickness: 0.7, color: 'white', opacity: 0, delay: delay + 0.25,
      keys: [{ t: 0, scale: 0.7, opacity: 0.8 }, { t: 0.9, scale: 2.4, opacity: 0, ease: 'snappy' }] },
    { shape: 'rect', x, y, w: size, h: r2(size * 0.5625), radius: size * 0.22, color, color2: 'violet', angle: 135, glow: 4, shadow: 8, delay,
      keys: [{ t: 0, scale: 0.2, opacity: 0, rotate: -14 }, { t: 0.55, scale: 1, opacity: 1, rotate: 0, ease: 'bounce' }] },
    { shape: 'text', x, y: r2(y + 0.4), text: l, size: r2(size * 0.62), weight: 900, color: 'white', delay: delay + 0.15, motion: 'pop' },
    ...burst({ x, y, delay: delay + 0.45, count: 22 }),
  ];
}

/** Panels that slide in one after another, each with an accent bar, a label and a title. */
export function cardStack({ cards = [], x = 50, y = 30, w = 84, h = 15.5, gap = 19, delay = 0.3, color = 'accent' } = {}) {
  const palette = [color, 'orange', 'pink', 'green', 'violet'];
  const out = [];
  cards.slice(0, 4).forEach((c, i) => {
    const title = typeof c === 'string' ? c : c.title, sub = typeof c === 'string' ? '' : c.sub || '';
    const cy = r2(y + i * gap), d = r2(delay + i * 0.55), tone = palette[i % palette.length];
    const left = r2(x - w / 2);
    out.push(
      { shape: 'rect', x, y: cy, w, h, radius: 1.6, color: 'black', opacity: 0.55, stroke: tone, strokeW: 0.25, motion: 'slide_left', delay: d },
      { shape: 'rect', x: r2(left + 0.9), y: cy, w: 1.2, h, color: tone, glow: 2, motion: 'slide_left', delay: d },
      { shape: 'text', x: r2(left + 4), y: r2(cy - (sub ? 2.8 : 0)), text: cut(title, 40), size: 6, weight: 900, color: 'white', origin: 'left', maxw: w - 8, reveal: 'chars', revealStep: 0.02, delay: d + 0.2, shadow: 3 },
    );
    if (sub) out.push({ shape: 'text', x: r2(left + 4), y: r2(cy + 4), text: cut(sub, 60), size: 3.4, weight: 600, color: 'muted', origin: 'left', maxw: w - 8, motion: 'fade_in', delay: d + 0.45 });
  });
  return out;
}

/** A big number with a label and an underline that draws on. */
export function statPop({ value = '', label = '', x = 50, y = 42, size = 24, delay = 0.2, color = 'yellow' } = {}) {
  return [
    { shape: 'text', x, y, text: cut(value, 12), size, weight: 900, color, stroke: 'black', strokeW: 1.2, shadow: 8, glow: 3, delay,
      keys: [{ t: 0, scale: 0.4, opacity: 0 }, { t: 0.5, scale: 1.12, opacity: 1, ease: 'bounce' }, { t: 0.8, scale: 1, ease: 'smooth' }] },
    { shape: 'pill', x, y: r2(y + size * 0.62), w: 46, h: 0.9, color, glow: 2, delay: delay + 0.5, origin: 'center',
      keys: [{ t: 0, scale: 0.05, opacity: 0 }, { t: 0.5, scale: 1, opacity: 1, ease: 'snappy' }] },
    { shape: 'text', x, y: r2(y + size * 0.62 + 6), text: cut(label, 40), size: 4.6, weight: 700, spacing: 0.12, caps: true, color: 'white', maxw: 86, motion: 'fade_in', delay: delay + 0.7, shadow: 4 },
  ];
}

/** A name bar that slides in from the left, for a brand, a speaker or a product. */
export function lowerThird({ title = '', sub = '', y = 84, delay = 0.2, color = 'accent' } = {}) {
  return [
    { shape: 'rect', x: 40, y, w: 70, h: 9, radius: 1.2, color: 'black', opacity: 0.6, stroke: color, strokeW: 0.25, motion: 'slide_left', delay },
    { shape: 'rect', x: 5.6, y, w: 1.2, h: 9, color, glow: 2, motion: 'slide_left', delay },
    { shape: 'text', x: 9, y: r2(y - (sub ? 1.6 : 0)), text: cut(title, 36), size: 5, weight: 900, color: 'white', origin: 'left', maxw: 62, motion: 'fade_in', delay: delay + 0.25 },
    ...(sub ? [{ shape: 'text', x: 9, y: r2(y + 2.6), text: cut(sub, 50), size: 2.8, weight: 600, color: 'muted', origin: 'left', maxw: 62, motion: 'fade_in', delay: delay + 0.4 }] : []),
  ];
}

/** A caption that holds from `start` to `end` seconds (pass real word times to sync it to speech). */
export function caption({ text, start = 0, end = 2, y = 72, size = 8 } = {}) {
  const lead = Math.max(0, start - 0.06), e = Math.max(lead + 0.3, end);
  const keys = [];
  if (lead > 0) keys.push({ t: 0, opacity: 0 });
  keys.push({ t: r2(lead), opacity: 0, scale: 1.15 }, { t: r2(lead + 0.14), opacity: 1, scale: 1, ease: 'smooth' }, { t: r2(e), opacity: 1, scale: 1 }, { t: r2(e + 0.25), opacity: 0 });
  return [{ shape: 'text', x: 50, y: 72 === y ? 72 : y, text: cut(text, 90), size: clamp(size - text.length / 30, 4.6, size), weight: 900, caps: true, maxw: 88, color: 'white', stroke: 'black', strokeW: 1.1, shadow: 6, fixed: true, keys }];
}

const sceneBase = (id, duration, layers, extra = {}) => ({ id, type: 'graphic', duration, background: 'gradient', ...extra, params: { layers, ...(extra.params || {}) } });

const STYLES = Object.freeze({
  bright: { a: 'violet', b: 'blue', accent: 'yellow' },
  warm: { a: 'orange', b: 'pink', accent: 'yellow' },
  cool: { a: 'blue', b: 'green', accent: 'white' },
});

/**
 * A whole promo video from a few facts. Scenes: hook, points (optional), stat (optional), brand reveal, end card.
 * Returns a validated v2 project. `bpm` makes every scene pulse on the beat (pair it with a beat from lib/adBeat.js).
 */
export function promoVideo({ brand, letter, hook, points = [], stat = null, cta, tagline = '', mood = 'bold', palette = 'ocean-blue', format = 'portrait', style = 'bright', bpm = null, concept = true, name } = {}) {
  if (!brand || typeof brand !== 'string') throw fail('brand is required.');
  if (!hook || typeof hook !== 'string') throw fail('hook is required.');
  const S = STYLES[style];
  if (!S) throw fail(`style must be one of ${Object.keys(STYLES).join(', ')}.`);
  const pts = (Array.isArray(points) ? points : []).slice(0, 4);
  const beat = (from) => (bpm ? { bpm: clamp(Math.round(bpm), 60, 200), beatZoom: 0.02, beatShake: 0.15, beatOffset: r2((60 / bpm - (from % (60 / bpm))) % (60 / bpm)) } : {});
  const scenes = [];
  let t = 0;
  const add = (sc) => { if (sc.type === 'graphic') sc.params = { ...sc.params, ...beat(t) }; scenes.push(sc); t += sc.duration; };

  add(sceneBase('hook', 3.2, [...glowBlobs({ a: S.a, b: S.b }), ...kineticTitle({ text: hook, y: 46, size: 11, color: 'white' }), ...burst({ x: 50, y: 46, color: S.accent, delay: 1.1 })],
    { transitionOut: 'wipe_left', params: { camera: [{ t: 0, zoom: 1 }, { t: 3.2, zoom: 1.12, ease: 'smooth' }] } }));
  if (pts.length) {
    const cardLayers = cardStack({ cards: pts, y: 27, color: 'accent' });
    add(sceneBase('points', clamp(1.6 + pts.length * 1.1, 3, 6), [...glowBlobs({ y: 60, a: S.b, b: S.a }), { shape: 'text', x: 50, y: 11, text: cut(brand, 30), size: 4.6, weight: 800, spacing: 0.16, caps: true, color: 'muted', fixed: true, motion: 'fade_in' }, ...cardLayers],
      { transitionOut: 'slide_up', background: 'grid' }));
  }
  if (stat && stat.value) add(sceneBase('stat', 3, [...glowBlobs({ y: 38, a: S.a, b: S.b }), ...statPop({ value: stat.value, label: stat.label || '', color: S.accent }), ...burst({ x: 50, y: 40, color: S.accent, delay: 0.6, count: 16 })], { transitionOut: 'crossfade' }));
  add(sceneBase('brand', 3.2, [...glowBlobs({ y: 34, a: S.a, b: S.b }), ...logoReveal({ letter: letter || brand, y: 34 }), ...kineticTitle({ text: brand, y: 60, size: 12, delay: 1 }),
    ...(tagline ? [{ shape: 'text', x: 50, y: 72, text: cut(tagline, 60), size: 4.2, weight: 700, color: 'muted', maxw: 80, motion: 'fade_in', delay: 1.8 }] : [])], { transitionOut: 'zoom_through', background: 'orbits' }));
  add({ id: 'end', type: 'end_card', duration: 2.6, params: { cta: cut(cta || `Try ${brand}`, 35), ...(tagline ? { tagline: cut(tagline, 60) } : {}) }, background: 'orbits' });

  const project = { specVersion: 2, name: cut(name || `${brand} promo`, 60), mood, palette, concept, platform: { format, lengthSec: t > 15 ? 30 : 15 }, scenes };
  const check = validateProjectV2(project);
  if (!check.ok) throw fail(`The promo does not validate: ${check.errors.slice(0, 3).join(' | ')}`);
  return project;
}
