// Chroma keyer: pure pixel math shared by the player (embedded between the KEY markers) and the tests.
// keyFrame works on straight (non-premultiplied) RGBA bytes, the format canvas getImageData returns.
// Pipeline: raw matte from chroma distance -> edge colour decontamination -> spill suppression -> matte grow/shrink -> feather.
// Everything is deterministic: no randomness, no time, the same pixels in always give the same pixels out.
// Presets are typical lit screens (not pure primaries), so the default tolerance works on real footage.
export const KEY_PRESETS = { green: [24, 190, 72], blue: [24, 64, 200] };
export const KEY_VIEWS = ['final', 'original', 'foreground', 'matte'];

export function keyFrame(src, w, h, o) {
  const n = w * h, out = new Uint8ClampedArray(n * 4), view = o.view || 'final';
  const hex = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? [1, 3, 5].map((i) => parseInt(o.color.slice(i, i + 2), 16)) : null;
  const K = o.key === 'custom' ? (hex || KEY_PRESETS.green) : (o.key === 'blue' ? KEY_PRESETS.blue : KEY_PRESETS.green);
  if (view === 'original') { for (let i = 0; i < n * 4; i += 4) { out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = 255; } return out; }
  const cbcr = (r, g, b) => [-0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b];
  const [kcb, kcr] = cbcr(K[0], K[1], K[2]);
  const tol = Math.min(100, Math.max(0, +o.tol || 0)) * 1.4, soft = Math.min(100, Math.max(0, o.soft === undefined ? 10 : +o.soft)) * 1.4 + 1e-3;
  const spill = Math.min(100, Math.max(0, +o.spill || 0)) / 100;
  const dom = K[0] >= K[1] && K[0] >= K[2] ? 0 : (K[1] >= K[2] ? 1 : 2);
  const a0 = new Float32Array(n), fg = new Float32Array(n * 3), Yk = 0.299 * K[0] + 0.587 * K[1] + 0.114 * K[2] + 1e-3;
  // Pass 1: raw matte. The key chroma is scaled to each pixel's brightness, so a screen lit unevenly (a vignette) still keys.
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2], Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const f = Math.min(1.6, Math.max(0.6, Y / Yk)), [cb, cr] = cbcr(r, g, b), d = Math.hypot(cb - kcb * f, cr - kcr * f);
    let t = (d - tol) / soft; t = t < 0 ? 0 : t > 1 ? 1 : t;
    a0[p] = t * t * (3 - 2 * t) * (src[i + 3] / 255);
  }
  // Local screen colour: the average of nearby pixels that are clearly screen. Edge pixels are un-mixed against this, not a flat colour.
  // Averaged on an 8px grid (cheap), then smoothed over neighbouring cells.
  const GB = 8, gw = Math.ceil(w / GB), gh = Math.ceil(h / GB), gn = gw * gh, gs = [new Float32Array(gn), new Float32Array(gn), new Float32Array(gn)], gwt = new Float32Array(gn);
  for (let p = 0, i = 0; p < n; p++, i += 4) if (a0[p] < 0.02 && src[i + 3] === 255) { const c = ((p / w | 0) / GB | 0) * gw + ((p % w) / GB | 0); gwt[c]++; gs[0][c] += src[i]; gs[1][c] += src[i + 1]; gs[2][c] += src[i + 2]; }
  const bw = blur(gwt, gw, gh, 3), ch = gs.map((a) => blur(a, gw, gh, 3));
  // Pass 2: decontaminate edges, suppress spill.
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2], a = a0[p];
    if (!(a > 0.004 && a < 0.999 && src[i + 3] === 255) && !(spill > 0)) { fg[p * 3] = r; fg[p * 3 + 1] = g; fg[p * 3 + 2] = b; continue; }
    const c4 = ((p / w | 0) / GB | 0) * gw + ((p % w) / GB | 0), ok = bw[c4] > 0.5;
    const k0 = ok ? ch[0][c4] / bw[c4] : K[0], k1 = ok ? ch[1][c4] / bw[c4] : K[1], k2 = ok ? ch[2][c4] / bw[c4] : K[2];
    // Edge pixels are a mix of foreground and the screen colour: take the screen's share back out (never for solid pixels).
    let R = r, G = g, B = b;
    if (a > 0.004 && a < 0.999 && src[i + 3] === 255) { const k = 1 / a, m = 1 - a; R = (r - m * k0) * k; G = (g - m * k1) * k; B = (b - m * k2) * k; }
    // Spill: the screen colour reflecting onto the subject. Pull the dominant channel down to the average of the other two.
    const c = [R, G, B], lim = (c[(dom + 1) % 3] + c[(dom + 2) % 3]) / 2;
    if (spill > 0 && c[dom] > lim) c[dom] -= spill * (c[dom] - lim);
    fg[p * 3] = c[0] < 0 ? 0 : c[0] > 255 ? 255 : c[0]; fg[p * 3 + 1] = c[1] < 0 ? 0 : c[1] > 255 ? 255 : c[1]; fg[p * 3 + 2] = c[2] < 0 ? 0 : c[2] > 255 ? 255 : c[2];
  }
  let a = a0;
  const grow = Math.round(+o.grow || 0);
  if (grow) a = morph(a, w, h, Math.abs(grow), grow > 0);
  const feather = Math.round(+o.feather || 0);
  if (feather > 0) { a = blur(a, w, h, feather); a = blur(a, w, h, feather); }
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const al = a[p] < 0 ? 0 : a[p] > 1 ? 1 : a[p];
    if (view === 'matte') { const v = Math.round(al * 255); out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255; }
    else if (view === 'foreground') {
      // Foreground over a fixed checkerboard so partial transparency is visible.
      const x = p % w, y = (p / w) | 0, chk = ((x >> 3) + (y >> 3)) & 1 ? 200 : 140;
      for (let c = 0; c < 3; c++) out[i + c] = fg[p * 3 + c] * al + chk * (1 - al);
      out[i + 3] = 255;
    } else { out[i] = fg[p * 3]; out[i + 1] = fg[p * 3 + 1]; out[i + 2] = fg[p * 3 + 2]; out[i + 3] = Math.round(al * 255); }
  }
  return out;
}
// Separable max (dilate) or min (erode) filter, radius in pixels.
function morph(a, w, h, r, dilate) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length), pick = dilate ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = a[y * w + x]; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) v = pick(v, a[y * w + xx]); } t[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = t[y * w + x]; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) v = pick(v, t[yy * w + x]); } o[y * w + x] = v; }
  return o;
}
// Separable box blur, edges clamp.
function blur(a, w, h, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length), s = 2 * r + 1;
  for (let y = 0; y < h; y++) { let acc = 0; for (let k = -r; k <= r; k++) acc += a[y * w + Math.min(w - 1, Math.max(0, k))]; for (let x = 0; x < w; x++) { t[y * w + x] = acc / s; acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0; for (let k = -r; k <= r; k++) acc += t[Math.min(h - 1, Math.max(0, k)) * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = acc / s; acc += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
  return o;
}
// Plain "over" composite of straight RGBA onto an opaque background, in premultiplied maths. Used by tests and the keyer demo.
export function overBackground(rgba, bg) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) { const a = rgba[i + 3] / 255; for (let c = 0; c < 3; c++) out[i + c] = rgba[i + c] * a + bg[c] * (1 - a); out[i + 3] = 255; }
  return out;
}
