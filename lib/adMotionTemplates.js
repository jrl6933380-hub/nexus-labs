// More building blocks and two more one-call templates for the motion kit: before/after and product showcase.
//   import { beforeAfterVideo, showcaseVideo } from './adMotionTemplates.js';
// Plain vocabulary (v2) data in, strict-validated project out. Pairs with lib/adMotionKit.js.
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { glowBlobs, kineticTitle, burst, logoReveal, statPop } from './adMotionKit.js';

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cut = (s, n) => [...String(s ?? '')].slice(0, n).join('');
const fail = (m) => Object.assign(new Error(m), { status: 400, code: 'MOTION_KIT_INVALID' });
const sceneBase = (id, duration, layers, extra = {}) => ({ id, type: 'graphic', duration, background: 'gradient', ...extra, params: { layers, ...(extra.params || {}) } });
const STYLES = Object.freeze({
  bright: { a: 'violet', b: 'blue', accent: 'yellow' },
  warm: { a: 'orange', b: 'pink', accent: 'yellow' },
  cool: { a: 'blue', b: 'green', accent: 'white' },
});

/** Confetti that rains down across the frame, for a win or a launch. */
export function confetti({ colors = ['yellow', 'pink', 'blue', 'green', 'orange'], delay = 0, count = 36 } = {}) {
  return colors.slice(0, 5).map((color, i) => ({ shape: 'rect', x: 50, y: -4, w: 2.2, h: 1.2, radius: 0.2, color, emit: clamp(Math.round(count / colors.length), 1, 40), emitSpan: 1.2,
    life: 2.2, driftY: 70, driftX: 0, spread: 46, delay: r2(delay + i * 0.08) }));
}

/** A bar that fills to `pct` with a label, for scores, progress or a before/after change. */
export function progressBar({ label = '', pct = 80, x = 50, y = 50, w = 78, color = 'green', delay = 0.2 } = {}) {
  const p = clamp(Number(pct) || 0, 0, 100), left = r2(x - w / 2), fw = r2((w * p) / 100);
  return [
    { shape: 'text', x: left, y: r2(y - 4.6), text: cut(label, 32), size: 3.8, weight: 800, color: 'white', origin: 'left', maxw: w, motion: 'fade_in', delay, shadow: 3 },
    { shape: 'pill', x, y, w, h: 2.6, color: 'white', opacity: 0.14, motion: 'fade_in', delay },
    { shape: 'pill', x: r2(left + fw / 2), y, w: Math.max(fw, 1), h: 2.6, color, glow: 2.5, delay: delay + 0.2,
      keys: [{ t: 0, scale: 0.05, opacity: 0 }, { t: 0.9, scale: 1, opacity: 1, ease: 'smooth' }] },
    { shape: 'text', x: r2(left + w), y: r2(y - 4.6), text: `${Math.round(p)}%`, size: 3.8, weight: 900, color, origin: 'right', motion: 'pop', delay: delay + 0.9 },
  ];
}

/** Ticked rows that check off one at a time. */
export function checklist({ items = [], x = 10, y = 30, gap = 11, size = 5.2, color = 'green', delay = 0.3 } = {}) {
  const out = [];
  items.slice(0, 6).forEach((it, i) => {
    const cy = r2(y + i * gap), d = r2(delay + i * 0.5);
    out.push(
      { shape: 'circle', x: r2(x + 2.6), y: cy, w: 5.6, color, glow: 2, delay: d, keys: [{ t: 0, scale: 0.1, opacity: 0 }, { t: 0.4, scale: 1, opacity: 1, ease: 'bounce' }] },
      { shape: 'text', x: r2(x + 2.6), y: r2(cy + 0.2), text: '✓', size: 3.8, weight: 900, color: 'black', delay: d + 0.15, motion: 'pop' },
      { shape: 'text', x: r2(x + 7), y: cy, text: cut(it, 36), size, weight: 800, color: 'white', origin: 'left', maxw: 100 - x - 9, reveal: 'chars', revealStep: 0.02, delay: d + 0.2, shadow: 3 },
    );
  });
  return out;
}

/** Two side-by-side panels: a "before" label on the left and an "after" on the right. */
export function versus({ left = 'Before', right = 'After', y = 30, h = 40, delay = 0.2, a = 'pink', b = 'green' } = {}) {
  return [
    { shape: 'rect', x: 26, y, w: 44, h, radius: 1.6, color: 'black', opacity: 0.55, stroke: a, strokeW: 0.3, motion: 'slide_left', delay },
    { shape: 'rect', x: 74, y, w: 44, h, radius: 1.6, color: 'black', opacity: 0.55, stroke: b, strokeW: 0.3, motion: 'slide_up', delay: delay + 0.5 },
    { shape: 'text', x: 26, y: r2(y - h / 2 + 4), text: cut(left, 14), size: 3.6, weight: 900, spacing: 0.14, caps: true, color: a, motion: 'fade_in', delay: delay + 0.3 },
    { shape: 'text', x: 74, y: r2(y - h / 2 + 4), text: cut(right, 14), size: 3.6, weight: 900, spacing: 0.14, caps: true, color: b, motion: 'fade_in', delay: delay + 0.8 },
  ];
}

const common = ({ brand, hook, style, bpm }) => {
  if (!brand || typeof brand !== 'string') throw fail('brand is required.');
  if (!hook || typeof hook !== 'string') throw fail('hook is required.');
  const S = STYLES[style];
  if (!S) throw fail(`style must be one of ${Object.keys(STYLES).join(', ')}.`);
  const beat = (from) => (bpm ? { bpm: clamp(Math.round(bpm), 60, 200), beatZoom: 0.02, beatShake: 0.15, beatOffset: r2((60 / bpm - (from % (60 / bpm))) % (60 / bpm)) } : {});
  const scenes = []; let t = 0;
  const add = (sc) => { if (sc.type === 'graphic') sc.params = { ...sc.params, ...beat(t) }; scenes.push(sc); t += sc.duration; };
  return { S, scenes, add, total: () => t };
};
const finish = ({ scenes, total }, { name, brand, suffix, mood, palette, concept, format }) => {
  const project = { specVersion: 2, name: cut(name || `${brand} ${suffix}`, 60), mood, palette, concept, platform: { format, lengthSec: total() > 15 ? 30 : 15 }, scenes };
  const check = validateProjectV2(project);
  if (!check.ok) throw fail(`The video does not validate: ${check.errors.slice(0, 3).join(' | ')}`);
  return project;
};
const outro = (add, S, { brand, letter, cta, tagline }) => {
  add(sceneBase('brand', 3, [...glowBlobs({ y: 34, a: S.a, b: S.b }), ...logoReveal({ letter: letter || brand, y: 34 }), ...kineticTitle({ text: brand, y: 60, size: 12, delay: 1 })], { transitionOut: 'zoom_through', background: 'orbits' }));
  add({ id: 'end', type: 'end_card', duration: 2.6, params: { cta: cut(cta || `Try ${brand}`, 35), ...(tagline ? { tagline: cut(tagline, 60) } : {}) }, background: 'orbits' });
};

/** Before / after: a problem, the change, the numbers that moved, then the brand. `bars` are {label, before, after} (0-100). */
export function beforeAfterVideo({ brand, letter, hook, before = 'Before', after = 'After', beforeNote = '', afterNote = '', bars = [], cta, tagline = '', mood = 'bold', palette = 'ocean-blue', format = 'portrait', style = 'bright', bpm = null, concept = true, name } = {}) {
  const c = common({ brand, hook, style, bpm }); const { S, add } = c;
  add(sceneBase('hook', 3, [...glowBlobs({ a: S.a, b: S.b }), ...kineticTitle({ text: hook, y: 46, size: 11 })], { transitionOut: 'wipe_left' }));
  add(sceneBase('before', 3, [...glowBlobs({ y: 45, a: 'pink', b: 'orange' }), ...versus({ left: before, right: after, y: 44, h: 46 }),
    ...(beforeNote ? [{ shape: 'text', x: 26, y: 46, text: cut(beforeNote, 40), size: 4.4, weight: 800, color: 'white', maxw: 38, motion: 'fade_in', delay: 0.8 }] : []),
    ...(afterNote ? [{ shape: 'text', x: 74, y: 46, text: cut(afterNote, 40), size: 4.4, weight: 800, color: 'white', maxw: 38, motion: 'fade_in', delay: 1.3 }] : [])], { transitionOut: 'slide_up', background: 'grid' }));
  const bs = (Array.isArray(bars) ? bars : []).slice(0, 3);
  if (bs.length) {
    const lay = [...glowBlobs({ y: 60, a: S.b, b: S.a }), { shape: 'text', x: 50, y: 12, text: 'The difference', size: 5, weight: 900, caps: true, spacing: 0.14, color: 'white', fixed: true, motion: 'fade_in' }];
    bs.forEach((b, i) => {
      const y = 30 + i * 22;
      lay.push(...progressBar({ label: `${cut(b.label, 24)} — before`, pct: b.before, y, color: 'pink', delay: 0.2 + i * 0.5 }),
        ...progressBar({ label: `${cut(b.label, 24)} — after`, pct: b.after, y: y + 9, color: 'green', delay: 0.6 + i * 0.5 }));
    });
    add(sceneBase('bars', 3.4, lay, { transitionOut: 'crossfade' }));
  }
  outro(add, S, { brand, letter, cta, tagline });
  return finish(c, { name, brand, suffix: 'before and after', mood, palette, concept, format });
}

/** Product showcase: the hook, a feature checklist, a proof stat with confetti, then the brand. */
export function showcaseVideo({ brand, letter, hook, features = [], stat = null, cta, tagline = '', mood = 'bold', palette = 'ocean-blue', format = 'portrait', style = 'bright', bpm = null, concept = true, name } = {}) {
  const c = common({ brand, hook, style, bpm }); const { S, add } = c;
  add(sceneBase('hook', 3, [...glowBlobs({ a: S.a, b: S.b }), ...kineticTitle({ text: hook, y: 46, size: 11 }), ...burst({ x: 50, y: 46, color: S.accent, delay: 1 })], { transitionOut: 'wipe_left', params: { camera: [{ t: 0, zoom: 1 }, { t: 3, zoom: 1.1, ease: 'smooth' }] } }));
  const fs = (Array.isArray(features) ? features : []).slice(0, 5);
  if (fs.length) add(sceneBase('features', clamp(1.5 + fs.length * 0.9, 3, 6), [...glowBlobs({ y: 58, a: S.b, b: S.a }), { shape: 'text', x: 50, y: 12, text: cut(brand, 30), size: 4.6, weight: 800, spacing: 0.16, caps: true, color: 'muted', fixed: true, motion: 'fade_in' }, ...checklist({ items: fs, y: 28, gap: 13 })], { transitionOut: 'slide_up', background: 'grid' }));
  if (stat && stat.value) add(sceneBase('stat', 3.2, [...glowBlobs({ y: 38, a: S.a, b: S.b }), ...statPop({ value: stat.value, label: stat.label || '', color: S.accent }), ...confetti({ delay: 0.5 })], { transitionOut: 'crossfade' }));
  outro(add, S, { brand, letter, cta, tagline });
  return finish(c, { name, brand, suffix: 'showcase', mood, palette, concept, format });
}
