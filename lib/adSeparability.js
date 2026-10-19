// Can this uploaded picture be split into layers, and what would it take? Answers from the pixels, never from hope.
// Nothing here recovers content that is not in the picture: anything hidden behind another object stays hidden.
import { decodePng } from './pngDecode.js';
import { keyFrame, KEY_PRESETS } from '../public/ad-key.mjs';

const hex = (c) => '#' + c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');

// Returns { ok, size, alpha, border, key, verdict, needs, note }.
//   verdict: 'has-alpha'  the picture already carries transparency; use it as a layer as is
//            'keyable'    the picture has a flat backdrop that a chroma key can remove (key mode and color given)
//            'needs-mask' the picture is flat; supply a matte or mask image, or cut it by hand
//   needs:   what the next step requires, in plain words
export function separabilityReport(png) {
  let img;
  try { img = typeof png === 'object' && png.rgba ? png : decodePng(png); } catch (e) { return { ok: false, error: `Could not read the picture: ${e.message}. Send an 8-bit non-interlaced PNG (JPEG: convert to PNG first).` }; }
  const { width: w, height: h, rgba } = img, n = w * h;
  let clear = 0, partial = 0;
  for (let i = 3; i < rgba.length; i += 4) { const a = rgba[i]; if (a === 0) clear++; else if (a < 255) partial++; }
  const alpha = { transparentPct: pct(clear, n), partialPct: pct(partial, n) };
  const size = { width: w, height: h };
  // Border ring: a flat backdrop shows up as one colour around the edge.
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02)), samples = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < ring || y < ring || x >= w - ring || y >= h - ring) { const i = (y * w + x) * 4; if (rgba[i + 3] === 255) samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]); }
  let mean = [0, 0, 0]; for (const s of samples) for (let c = 0; c < 3; c++) mean[c] += s[c] / (samples.length || 1);
  let near = 0; for (const s of samples) if (Math.abs(s[0] - mean[0]) + Math.abs(s[1] - mean[1]) + Math.abs(s[2] - mean[2]) < 90) near++;
  const border = { colour: samples.length ? hex(mean) : null, uniformPct: samples.length ? pct(near, samples.length) : 0 };
  if (alpha.transparentPct >= 1 || alpha.partialPct >= 1) {
    return { ok: true, size, alpha, border, key: null, verdict: 'has-alpha', needs: 'nothing: it already has transparency', note: 'Use it as an image layer. Parts that are not in the picture cannot be added.' };
  }
  // Try the backdrop as a key, and measure how clean the result is.
  const uniform = border.uniformPct >= 85;
  if (uniform) {
    const nearPreset = (p) => Math.abs(mean[0] - p[0]) + Math.abs(mean[1] - p[1]) + Math.abs(mean[2] - p[2]);
    const mode = nearPreset(KEY_PRESETS.green) < 150 ? 'green' : nearPreset(KEY_PRESETS.blue) < 150 ? 'blue' : 'custom';
    const out = keyFrame(rgba, w, h, { key: mode, color: hex(mean), tol: 30, soft: 10, spill: 40 });
    let solid = 0, gone = 0, edge = 0; for (let i = 3; i < out.length; i += 4) { const a = out[i]; if (a === 255) solid++; else if (a === 0) gone++; else edge++; }
    const key = { mode, color: hex(mean), subjectPct: pct(solid + edge, n), removedPct: pct(gone, n), softEdgePct: pct(edge, n) };
    if (key.subjectPct >= 2 && key.removedPct >= 10 && key.softEdgePct <= 12) {
      return { ok: true, size, alpha, border, key, verdict: 'keyable', needs: `a chroma key: key "${mode}"${mode === 'custom' ? ` with keyColor ${key.color}` : ''}; review the matte view, then use grow, feather or a garbage matte for rough edges`, note: 'Only the backdrop is removed. Anything the subject covers stays covered.' };
    }
    return { ok: true, size, alpha, border, key, verdict: 'needs-mask', needs: 'a supplied matte image (matteImage), a hand-drawn matte polygon, or an optional segmentation model: the backdrop is flat but the key leaves too many half-transparent or missing pixels', note: 'A key was tried and was not clean enough. Hidden content cannot be recovered.' };
  }
  return { ok: true, size, alpha, border, key: null, verdict: 'needs-mask', needs: 'a supplied matte image (matteImage), a hand-drawn matte polygon, manual cut-out, or an optional segmentation model: the picture is flat with no uniform backdrop to key', note: 'This is one flat layer. Separating objects in it needs outside help, and content hidden behind other objects cannot be recovered.' };
}
function pct(v, d) { return Math.round(v / d * 1000) / 10; }
