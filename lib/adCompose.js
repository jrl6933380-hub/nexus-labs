// Composition and typography helpers for graphic scenes. Pure, deterministic, no DOM and no fonts needed:
// text is measured with a per-character width table (em units), so the same input gives the same layout on any machine.
// Everything here returns plain data that goes straight into scene layers (percent of frame width/height).
import { MOODS, PALETTES, FORMATS } from '../public/ad-vocabulary.mjs';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;

// ---- measuring and fitting text ---------------------------------------------------------------------
const NARROW = 'iljtfI.,:;\'!|()[]/ ';
const WIDE = 'mwMW@%';
const CAPS = /[A-Z0-9]/;
// Width of one character in em at weight 400; heavier weights widen it a little.
export function charEm(ch, weight = 700) {
  let w = NARROW.includes(ch) ? 0.3 : WIDE.includes(ch) ? 0.85 : CAPS.test(ch) ? 0.66 : 0.52;
  if (ch === ' ') w = 0.28;
  return w * (1 + clamp((weight - 400) / 400, 0, 1.2) * 0.08);
}
export function measureEm(text, { weight = 700, spacing = 0, caps = false } = {}) {
  let t = String(text);
  if (caps) t = t.toUpperCase();
  let w = 0;
  for (const ch of t) w += charEm(ch, weight) + spacing;
  return w;
}
// Greedy word wrap at a width in em. Returns the lines (a word longer than the line gets its own line).
export function wrapLines(text, maxEm, opts = {}) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && measureEm(next, opts) > maxEm) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
// Largest size (percent of frame width, the unit of a text layer's `size`) at which `text` fits a box.
// box.w is percent of frame width, box.h percent of frame HEIGHT; frame is {w,h} pixels (aspect only matters).
export function fitText(text, box, { frame = { w: 560, h: 560 }, min = 2, max = 18, weight = 800, spacing = 0, caps = false, lineHeight = 1.12, maxLines = 4 } = {}) {
  const boxWpx = (box.w / 100) * frame.w;
  const boxHpx = (box.h / 100) * frame.h;
  const opts = { weight, spacing, caps };
  let best = null;
  for (let s = max; s >= min - 1e-9; s -= 0.25) {
    const px = (s / 100) * frame.w;
    const lines = wrapLines(text, boxWpx / px, opts);
    const widest = Math.max(0, ...lines.map((l) => measureEm(l, opts))) * px;
    const height = lines.length * px * lineHeight;
    if (lines.length <= maxLines && widest <= boxWpx + 0.5 && height <= boxHpx + 0.5) { best = { size: r2(s), lines, fits: true, widthPct: r2((widest / frame.w) * 100), heightPct: r2((height / frame.h) * 100) }; break; }
  }
  if (!best) {
    const lines = wrapLines(text, boxWpx / ((min / 100) * frame.w), opts);
    best = { size: min, lines, fits: false, widthPct: null, heightPct: null };
  }
  best.maxw = r2(box.w);
  return best;
}
// A ready text layer: fitted size, wrapped width, centered at the box center.
export function fittedText(text, box, opts = {}) {
  const f = fitText(text, box, opts);
  return { fit: f, layer: { shape: 'text', text, x: r2(box.x + box.w / 2), y: r2(box.y + box.h / 2), size: f.size, maxw: f.maxw, weight: opts.weight ?? 800 } };
}

// ---- grid, alignment, spacing -----------------------------------------------------------------------
// A column/row grid inside margins. Returns cell(c, r, spanC, spanR) -> {x, y, w, h, cx, cy} in percent of frame.
export function makeGrid({ cols = 6, rows = 8, margin = 6, gutter = 2, marginY = margin } = {}) {
  const cw = (100 - 2 * margin - gutter * (cols - 1)) / cols;
  const rh = (100 - 2 * marginY - gutter * (rows - 1)) / rows;
  const cell = (c, r, sc = 1, sr = 1) => {
    const x = margin + c * (cw + gutter), y = marginY + r * (rh + gutter);
    const w = sc * cw + (sc - 1) * gutter, h = sr * rh + (sr - 1) * gutter;
    return { x: r2(x), y: r2(y), w: r2(w), h: r2(h), cx: r2(x + w / 2), cy: r2(y + h / 2) };
  };
  return { cols, rows, margin, marginY, gutter, cell, safe: { x: margin, y: marginY, w: 100 - 2 * margin, h: 100 - 2 * marginY } };
}
// Align boxes {x,y,w,h} (top-left, percent) to the first/extreme edge or center.
export function alignBoxes(boxes, mode) {
  const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return boxes.map((b) => {
    switch (mode) {
      case 'left': return { ...b, x: r2(left) };
      case 'right': return { ...b, x: r2(right - b.w) };
      case 'center': return { ...b, x: r2((left + right) / 2 - b.w / 2) };
      case 'top': return { ...b, y: r2(top) };
      case 'bottom': return { ...b, y: r2(bottom - b.h) };
      case 'middle': return { ...b, y: r2((top + bottom) / 2 - b.h / 2) };
      default: throw new Error('align mode: left, right, center, top, bottom, middle');
    }
  });
}
// Equal gaps between boxes along an axis, keeping the first and last where they are.
export function distribute(boxes, axis = 'y') {
  const k = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
  const sorted = [...boxes].sort((a, b) => a[k[0]] - b[k[0]]);
  if (sorted.length < 3) return sorted;
  const first = sorted[0][k[0]], last = sorted[sorted.length - 1][k[0]] + sorted[sorted.length - 1][k[1]];
  const gap = (last - first - sorted.reduce((s, b) => s + b[k[1]], 0)) / (sorted.length - 1);
  let pos = first;
  return sorted.map((b) => { const o = { ...b, [k[0]]: r2(pos) }; pos += b[k[1]] + gap; return o; });
}
// Stack boxes of given heights top to bottom with a fixed gap, starting at y; returns boxes + total height.
export function stack(heights, { x = 0, w = 100, y = 0, gap = 2 } = {}) {
  let pos = y;
  const boxes = heights.map((h) => { const b = { x, y: r2(pos), w, h }; pos += h + gap; return b; });
  return { boxes, height: r2(pos - gap - y) };
}

// ---- focal-point crops ------------------------------------------------------------------------------
// Crop a source image (pixels) to a target aspect (w/h) keeping the focus point (0-1) as close to the middle
// of the crop as the edges allow, and optionally keeping a `keep` rect {x,y,w,h} (0-1) fully inside.
export function focalCrop({ srcW, srcH, focus = { x: 0.5, y: 0.5 }, aspect, keep = null }) {
  const srcAspect = srcW / srcH;
  let cw, ch;
  if (aspect >= srcAspect) { cw = 1; ch = srcAspect / aspect; } else { ch = 1; cw = aspect / srcAspect; }
  let x = clamp(focus.x - cw / 2, 0, 1 - cw), y = clamp(focus.y - ch / 2, 0, 1 - ch);
  let kept = true;
  if (keep) {
    // shift minimally so the keep-rect is inside; flag it if it cannot fit
    if (keep.x < x) x = clamp(keep.x, 0, 1 - cw);
    if (keep.x + keep.w > x + cw) x = clamp(keep.x + keep.w - cw, 0, 1 - cw);
    if (keep.y < y) y = clamp(keep.y, 0, 1 - ch);
    if (keep.y + keep.h > y + ch) y = clamp(keep.y + keep.h - ch, 0, 1 - ch);
    kept = keep.x >= x - 1e-9 && keep.x + keep.w <= x + cw + 1e-9 && keep.y >= y - 1e-9 && keep.y + keep.h <= y + ch + 1e-9;
  }
  return { x: r2(x * 1e4) / 1e4, y: r2(y * 1e4) / 1e4, w: r2(cw * 1e4) / 1e4, h: r2(ch * 1e4) / 1e4, pxW: Math.round(cw * srcW), pxH: Math.round(ch * srcH), kept };
}

// ---- per-aspect recomposition -----------------------------------------------------------------------
export const aspectOf = (formatId) => { const f = FORMATS.find((x) => x.id === formatId); if (!f) throw new Error('unknown format ' + formatId); return f.width / f.height; };
// Move one layer from one format to another. Position keeps its distance from the nearest edge in "design
// units" (so margins stay margins), size follows the shorter side so shapes keep their look, text re-fits.
// layer.ax / layer.ay: 'start' | 'end' | 'center' override the nearest-edge rule per axis (removed from the output).
export function reflowLayer(layer, fromId, toId) {
  const a = aspectOf(fromId), b = aspectOf(toId);
  const out = { ...layer };
  const k = Math.min(b, 1) / Math.min(a, 1);
  const moveAxis = (v, fromSize, toSize, anchor) => {
    if (v == null) return v;
    const edge = anchor || (v < 33 ? 'start' : v > 67 ? 'end' : 'center');
    const px = (v / 100) * fromSize;
    if (edge === 'start') return r2(((px * k) / toSize) * 100);
    if (edge === 'end') return r2(100 - (((fromSize - px) * k) / toSize) * 100);
    return v;
  };
  // pixel-ish design units: height 100 for every format, width = 100 * aspect
  const fw = a * 100, tw = b * 100, fh = 100, th = 100;
  out.x = moveAxis(layer.x, fw, tw, layer.ax); out.y = moveAxis(layer.y, fh, th, layer.ay);
  // w is percent of width: convert through design units so the on-screen size follows the new width
  if (layer.w != null) out.w = Math.min(100, r2(layer.w * (fw / tw) * k));
  if (layer.h != null) out.h = layer.h;
  if (layer.size != null) out.size = r2(layer.size * (fw / tw) * k);
  if (layer.maxw != null) out.maxw = clamp(r2(layer.maxw * (fw / tw) * k), 10, 100);
  if (layer.x2 != null) out.x2 = moveAxis(layer.x2, fw, tw, layer.ax);
  if (layer.y2 != null) out.y2 = moveAxis(layer.y2, fh, th, layer.ay);
  delete out.ax; delete out.ay;
  return out;
}
// Recompose a scene's layers; `overrides` is {layerIndex or id: partial layer} for hand-tuned fixes.
export function recomposeLayers(layers, fromId, toId, overrides = {}) {
  return layers.map((l, i) => {
    const moved = reflowLayer(l, fromId, toId);
    const ov = overrides[l.id] || overrides[i];
    return ov ? { ...moved, ...ov } : moved;
  });
}
// Project-level: every graphic scene recomposed to the target format.
export function recomposeProject(project, toId, overrides = {}) {
  const fromId = project.platform?.format;
  if (fromId === toId) return project;
  return {
    ...project,
    platform: { ...project.platform, format: toId },
    scenes: project.scenes.map((s) => s.type === 'graphic' && s.params?.layers
      ? { ...s, params: { ...s.params, layers: recomposeLayers(s.params.layers, fromId, toId, overrides[s.id] || {}) } }
      : s),
  };
}

// ---- brand kits -------------------------------------------------------------------------------------
export const BRAND_LIMITS = Object.freeze({ maxPalettes: 6, maxAssets: 24, maxName: 60 });
const ID = /^[a-z0-9-]{3,40}$/;
// A brand kit narrows the closed vocabulary: approved palettes and moods (fonts come with moods), approved
// asset ids (logo, product shots) and a voice note. It stores ids only, never files or font data.
export function validateBrandKit(kit) {
  const errors = [];
  if (!kit || typeof kit !== 'object') return { ok: false, errors: ['kit must be an object'], value: null };
  const name = String(kit.name || '').trim();
  if (!name || name.length > BRAND_LIMITS.maxName) errors.push('name: 1-' + BRAND_LIMITS.maxName + ' characters');
  const palettes = Array.isArray(kit.palettes) ? kit.palettes : [];
  if (!palettes.length || palettes.length > BRAND_LIMITS.maxPalettes) errors.push('palettes: 1-' + BRAND_LIMITS.maxPalettes + ' palette ids');
  for (const p of palettes) if (!PALETTES.some((x) => x.id === p)) errors.push('palettes: unknown palette ' + p);
  const moods = Array.isArray(kit.moods) ? kit.moods : [];
  if (!moods.length) errors.push('moods: at least one mood (it sets the approved fonts)');
  for (const m of moods) if (!MOODS.some((x) => x.id === m)) errors.push('moods: unknown mood ' + m);
  const assets = kit.assets && typeof kit.assets === 'object' ? kit.assets : {};
  const ids = Object.values(assets).flat();
  if (ids.length > BRAND_LIMITS.maxAssets) errors.push('assets: at most ' + BRAND_LIMITS.maxAssets);
  for (const id of ids) if (!ID.test(String(id))) errors.push('assets: bad id ' + id);
  if (kit.logo != null && !ID.test(String(kit.logo))) errors.push('logo: bad asset id');
  if (kit.voice != null && String(kit.voice).length > 240) errors.push('voice: at most 240 characters');
  if (errors.length) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: { name, palettes: [...palettes], moods: [...moods], logo: kit.logo ?? null, assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, [...v]])), voice: kit.voice ? String(kit.voice) : '' } };
}
function imageIdsIn(project) {
  const ids = new Set();
  for (const s of project.scenes || []) {
    const p = s.params || {};
    if (p.imageId) ids.add(p.imageId);
    for (const l of p.layers || []) { if (l.imageId) ids.add(l.imageId); if (l.matteImage) ids.add(l.matteImage); }
  }
  return [...ids];
}
// Does an ad stay inside the kit? Returns a list of violations (empty = on brand).
export function checkBrand(project, kit) {
  const v = [];
  const k = kit.palettes ? kit : validateBrandKit(kit).value;
  if (!k) return ['invalid brand kit'];
  if (project.palette && !k.palettes.includes(project.palette)) v.push(`palette ${project.palette} is not approved (${k.palettes.join(', ')})`);
  if (project.mood && !k.moods.includes(project.mood)) v.push(`mood ${project.mood} is not approved (${k.moods.join(', ')})`);
  const approved = new Set([...(k.logo ? [k.logo] : []), ...Object.values(k.assets).flat()]);
  for (const id of imageIdsIn(project)) if (!approved.has(id)) v.push(`image ${id} is not an approved brand asset`);
  return v;
}
// Snap a project onto the kit: first approved palette/mood when the current ones are not approved.
export function applyBrand(project, kit) {
  const k = validateBrandKit(kit).value;
  if (!k) throw new Error('invalid brand kit');
  return { ...project, palette: k.palettes.includes(project.palette) ? project.palette : k.palettes[0], mood: k.moods.includes(project.mood) ? project.mood : k.moods[0] };
}
