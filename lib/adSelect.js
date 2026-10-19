// Reading a selection map: which layer is at this pixel, how much of the frame does each layer cover.
// The map itself is rendered by the player (?select=1). Here we only decode it and look colours up in the legend the player produced.
import { decodePng } from './pngDecode.js';
import { parseHex } from '../public/ad-select.mjs';

const near = (a, b, t) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t;

// legend: [{ id, color:'#rrggbb', name?, role? }, ...]. Pixels that match no legend colour (background, antialiased edges) are ignored.
export function selectionReport(png, legend, { tolerance = 3 } = {}) {
  const { width: w, height: h, rgba } = typeof png === 'object' && png.rgba ? png : decodePng(png);
  const cols = legend.map((l) => parseHex(l.color)), byKey = new Map(cols.map((c, i) => [c[0] << 16 | c[1] << 8 | c[2], i]));
  const st = legend.map(() => ({ n: 0, x0: w, y0: h, x1: -1, y1: -1, sx: 0, sy: 0 }));
  let matched = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] < 255) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    let k = byKey.get(r << 16 | g << 8 | b);
    if (k === undefined && tolerance > 0) { if (r === g && g === b) continue; for (let j = 0; j < cols.length; j++) if (near(cols[j], [r, g, b], tolerance)) { k = j; break; } }
    if (k === undefined) continue;
    const s = st[k]; s.n++; s.sx += x; s.sy += y; if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y; matched++;
  }
  const pct = (v, d) => Math.round(v / d * 1000) / 10;
  return {
    width: w, height: h, matchedPixels: matched,
    layers: legend.map((l, i) => {
      const s = st[i];
      return { id: l.id, name: l.name || null, role: l.role || null, color: l.color, visible: s.n > 0, pixels: s.n, coveragePct: pct(s.n, w * h),
        bboxPct: s.n ? { left: pct(s.x0, w), top: pct(s.y0, h), right: pct(s.x1 + 1, w), bottom: pct(s.y1 + 1, h) } : null,
        centerPct: s.n ? { x: pct(s.sx / s.n, w), y: pct(s.sy / s.n, h) } : null };
    }),
  };
}

// What is at (xPct, yPct)? Looks at a small window and takes the most common legend colour, so an antialiased edge still answers.
export function pickAt(png, legend, xPct, yPct, { radius = 2, tolerance = 3 } = {}) {
  const { width: w, height: h, rgba } = typeof png === 'object' && png.rgba ? png : decodePng(png);
  const cx = Math.round(xPct / 100 * (w - 1)), cy = Math.round(yPct / 100 * (h - 1)), cols = legend.map((l) => parseHex(l.color)), votes = new Map();
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
    const i = (y * w + x) * 4, c = [rgba[i], rgba[i + 1], rgba[i + 2]];
    if (c[0] === c[1] && c[1] === c[2]) continue;
    const k = cols.findIndex((q) => near(q, c, tolerance));
    if (k >= 0) votes.set(k, (votes.get(k) || 0) + 1);
  }
  if (!votes.size) return { ok: true, id: null, note: 'nothing selectable at that point (background, or a layer without an id)' };
  const [best] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return { ok: true, id: legend[best].id, name: legend[best].name || null, role: legend[best].role || null, color: legend[best].color };
}

// "The blue character": narrow the legend by what the layers are called or what they are, then confirm with the picture.
// Colour words match the layer's own palette colour (the artwork colour), not the identification colour.
export function findInLegend(layers, { color, role, name } = {}) {
  return layers.filter((l) => (color === undefined || l.color === color) && (role === undefined || l.role === role) && (name === undefined || String(l.name || l.id).toLowerCase().includes(String(name).toLowerCase()))).map((l) => l.id);
}
