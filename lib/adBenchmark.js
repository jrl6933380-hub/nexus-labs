// Visual benchmark that keeps improvements. Three separate judgments per case, never blended into one score:
//   technical   - did it validate, render without errors, repeat bit-for-bit, stay inside the frame
//   visual      - measured from the pixels (blank frames, clipping at the edges, contrast, change from the saved baseline)
//   performance - structural ad heuristics from the project (hook, CTA, text size, length). These are rules of thumb, NOT measured results.
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from './adGraphicDemos.js';

export const FORMAT_IDS = ['portrait', 'square', 'landscape'];
// category -> what it exercises. `demo` is a GRAPHIC_DEMOS key; categories without a built-in case list what they still need.
export const BENCH_CASES = [
  { id: 'typography', category: 'typography', demo: 'captions' },
  { id: 'product-card', category: 'product cutouts', demo: 'loadout' },
  { id: 'illustration', category: 'illustrations', demo: 'shapes' },
  { id: 'fast-motion', category: 'fast motion', demo: 'fight' },
  { id: 'character', category: 'characters', demo: 'motion' },
  { id: 'particles', category: 'particles', demo: 'particles' },
  { id: 'beat', category: 'audio reactive', demo: 'pulse' },
];
export const COVERAGE_GAPS = [
  { category: 'photographs', needs: 'a library photo (media id) to place in a photo_focus scene' },
  { category: 'footage', needs: 'a library clip (media id); the footage layer ships in the footage PR' },
  { category: 'narration', needs: 'a voice track; the voice work is paused' },
];
export const coverage = () => ({ covered: [...new Set(BENCH_CASES.map((c) => c.category))], gaps: COVERAGE_GAPS });

export function caseProject(c, format) {
  const demo = GRAPHIC_DEMOS[c.demo];
  if (!demo) throw new Error('unknown demo ' + c.demo);
  const p = JSON.parse(JSON.stringify(demo.project));
  p.platform = { ...p.platform, format };
  return { project: p, shots: demo.shots };
}

// ---- PNG pixels (8-bit, non-interlaced RGB/RGBA, what Chromium screenshots produce) -----------------
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), tag = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (tag === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (tag === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) throw new Error('unsupported PNG (need 8-bit RGB/RGBA, not interlaced)');
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  return { width: w, height: h, channels: bpp, data: px };
}
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
// Pixel measurements for the visual judgment.
export function pixelStats(img) {
  const { width: w, height: h, channels: c, data: d } = img;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 240));
  const counts = new Map();
  let n = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * c, key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3), l = lum(d, i);
    counts.set(key, (counts.get(key) || 0) + 1); n++; sum += l; sum2 += l * l;
  }
  const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let ink = 0, edgeInk = 0, edgeN = 0;
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.012));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * c, key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    const isInk = key !== bgKey;
    if (isInk) ink++;
    if (x < band || y < band || x >= w - band || y >= h - band) { edgeN++; if (isInk) edgeInk++; }
  }
  const mean = sum / n;
  return { width: w, height: h, meanLuma: Math.round(mean * 10) / 10, lumaStd: Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean)) * 10) / 10, contentRatio: Math.round((ink / n) * 1000) / 1000, edgeInkRatio: Math.round((edgeInk / Math.max(1, edgeN)) * 1000) / 1000 };
}
// Share of pixels that changed between two renders (same size), and the mean absolute channel difference.
export function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { sameSize: false, changedRatio: 1, meanAbs: 255 };
  const c = Math.min(a.channels, b.channels), step = Math.max(1, Math.floor(Math.min(a.width, a.height) / 240));
  let n = 0, changed = 0, abs = 0;
  for (let y = 0; y < a.height; y += step) for (let x = 0; x < a.width; x += step) {
    const ia = (y * a.width + x) * a.channels, ib = (y * b.width + x) * b.channels;
    let m = 0; for (let k = 0; k < 3 && k < c; k++) m += Math.abs(a.data[ia + k] - b.data[ib + k]);
    n++; abs += m / 3; if (m > 24) changed++;
  }
  return { sameSize: true, changedRatio: Math.round((changed / n) * 10000) / 10000, meanAbs: Math.round((abs / n) * 100) / 100 };
}
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- the three judgments ----------------------------------------------------------------------------
export function judgeTechnical({ project, errors = [], hashes = [], repeatHashes = null }) {
  const v = validateProjectV2(project), issues = [];
  if (!v.ok) issues.push('does not validate: ' + v.errors[0]);
  if (errors.length) issues.push('render errors: ' + errors.slice(0, 2).join(' | '));
  if (repeatHashes && JSON.stringify(hashes) !== JSON.stringify(repeatHashes)) issues.push('a second render gave different pixels');
  return { pass: !issues.length, issues };
}
export function judgeVisual(stats, diff = null, { maxChanged = 0.5 } = {}) {
  const issues = [], notes = [];
  for (const s of stats) {
    if (s.contentRatio < 0.02) issues.push(`a frame is almost empty (content ${s.contentRatio})`);
    if (s.lumaStd < 6) issues.push(`a frame has almost no contrast (std ${s.lumaStd})`);
    if (s.edgeInkRatio > 0.6 && s.contentRatio < 0.6) notes.push(`a frame is heavily filled at the edges (${s.edgeInkRatio}); check for clipping`);
  }
  if (diff && diff.some((d) => d.changedRatio > maxChanged)) notes.push('more than half of a frame changed against the baseline');
  return { pass: !issues.length, issues, notes };
}
// Structural heuristics only. The thresholds are conventions (hook in the first seconds, a clear CTA, legible text), not results.
export function judgePerformance(project) {
  const issues = [], notes = ['heuristics from the project structure, not measured ad performance'];
  const scenes = project.scenes || [];
  const first = scenes[0];
  const textOf = (s) => JSON.stringify(s.params || {});
  if (first && first.duration > 3.5) issues.push(`first scene is ${first.duration}s; the hook should land in about 3 seconds`);
  if (first && !/"text"|headline|title|line|cta/.test(textOf(first)) && first.type !== 'graphic') notes.push('first scene has no obvious headline field');
  const end = scenes[scenes.length - 1];
  if (!end || end.type !== 'end_card' || !end.params || !end.params.cta) issues.push('no end card with a call to action');
  const total = scenes.reduce((s, x) => s + (x.duration || 0), 0), target = project.platform && project.platform.lengthSec;
  if (target && total > target + 1) issues.push(`runs ${total}s, longer than its ${target}s target`);
  for (const s of scenes) for (const l of (s.params && s.params.layers) || []) if (l.shape === 'text' && l.size != null && l.size < 3 && !l.fixed) { issues.push(`text "${String(l.text).slice(0, 20)}" is below 3% of the width`); break; }
  return { pass: !issues.length, issues, notes };
}

// ---- run records and before/after -------------------------------------------------------------------
export function recordRun({ label, change, results, coverageInfo = coverage(), at = null }) {
  if (!label || !change) throw new Error('a run needs a label and a description of the specific change');
  return { label, change, at, coverage: coverageInfo, results };
}
// results rows: { caseId, format, shots: [{ms, sha256}], technical, visual, performance }
export function compareRuns(before, after) {
  const key = (r) => `${r.caseId}/${r.format}`;
  const b = new Map(before.results.map((r) => [key(r), r]));
  const out = { improved: [], regressed: [], changedPixels: [], added: [], removed: [] };
  for (const r of after.results) {
    const old = b.get(key(r));
    if (!old) { out.added.push(key(r)); continue; }
    for (const j of ['technical', 'visual', 'performance']) {
      if (old[j].pass && !r[j].pass) out.regressed.push(`${key(r)} ${j}: ${r[j].issues[0]}`);
      if (!old[j].pass && r[j].pass) out.improved.push(`${key(r)} ${j}`);
    }
    const same = JSON.stringify(old.shots.map((s) => s.sha256)) === JSON.stringify(r.shots.map((s) => s.sha256));
    if (!same) out.changedPixels.push(key(r));
    b.delete(key(r));
  }
  out.removed = [...b.keys()];
  out.summary = `${out.regressed.length} regressions, ${out.improved.length} improvements, ${out.changedPixels.length} cases with different pixels`;
  return out;
}
