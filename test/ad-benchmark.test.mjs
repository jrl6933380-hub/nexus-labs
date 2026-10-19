import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { BENCH_CASES, FORMAT_IDS, caseProject, coverage, decodePng, pixelStats, pixelDiff, judgeTechnical, judgeVisual, judgePerformance, recordRun, compareRuns } from '../lib/adBenchmark.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

// minimal PNG writer for tests: filter 0, RGB
function png(w, h, f) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
test('every case builds a valid project in every format; coverage names its gaps', () => {
  for (const c of BENCH_CASES) for (const f of FORMAT_IDS) { const { project, shots } = caseProject(c, f); assert.equal(validateProjectV2(project).ok, true, c.id + f); assert.ok(shots.length >= 3); assert.equal(project.platform.format, f); }
  const cov = coverage();
  assert.ok(cov.covered.includes('typography') && cov.gaps.map((g) => g.category).join().includes('narration'));
});
test('PNG decode and pixel stats see blank, busy and edge-filled frames', () => {
  const blank = pixelStats(decodePng(png(64, 64, () => [10, 20, 30])));
  assert.ok(blank.contentRatio < 0.02);
  const busy = pixelStats(decodePng(png(64, 64, (x, y) => (x > 20 && x < 44 && y > 20 && y < 44 ? [255, 255, 255] : [10, 20, 30]))));
  assert.ok(busy.contentRatio > 0.1 && busy.lumaStd > 20 && busy.edgeInkRatio === 0);
  const edge = pixelStats(decodePng(png(64, 64, (x) => (x < 2 ? [255, 0, 0] : [10, 20, 30]))));
  assert.ok(edge.edgeInkRatio > 0);
  assert.throws(() => decodePng(Buffer.from('nope1234')));
});
test('pixelDiff measures change against a baseline', () => {
  const a = decodePng(png(64, 64, () => [10, 20, 30])), b = decodePng(png(64, 64, (x) => (x < 32 ? [200, 0, 0] : [10, 20, 30])));
  assert.equal(pixelDiff(a, a).changedRatio, 0);
  assert.ok(pixelDiff(a, b).changedRatio > 0.4);
  assert.equal(pixelDiff(a, decodePng(png(32, 32, () => [0, 0, 0]))).sameSize, false);
});
test('three judgments stay separate', () => {
  const { project } = caseProject(BENCH_CASES[0], 'portrait');
  assert.equal(judgeTechnical({ project, hashes: ['a'], repeatHashes: ['a'] }).pass, true);
  assert.equal(judgeTechnical({ project, hashes: ['a'], repeatHashes: ['b'] }).pass, false);
  assert.equal(judgeTechnical({ project: { specVersion: 2 }, errors: ['boom'] }).pass, false);
  assert.equal(judgeVisual([{ contentRatio: 0.001, lumaStd: 2, edgeInkRatio: 0 }]).pass, false);
  assert.equal(judgeVisual([{ contentRatio: 0.3, lumaStd: 40, edgeInkRatio: 0.1 }]).pass, true);
  const bad = JSON.parse(JSON.stringify(project)); bad.scenes.pop();
  const perf = judgePerformance(bad);
  assert.equal(perf.pass, false); assert.ok(perf.notes[0].includes('not measured'));
});
test('runs need a described change; compareRuns reports regressions, improvements and pixel changes', () => {
  assert.throws(() => recordRun({ label: 'x', results: [] }));
  const ok = { pass: true, issues: [], notes: [] }, no = { pass: false, issues: ['bad'], notes: [] };
  const row = (v, sha, tech = ok) => ({ caseId: 'typography', format: 'square', shots: [{ ms: 0, sha256: sha }], technical: tech, visual: v, performance: ok });
  const A = recordRun({ label: 'a', change: 'baseline', results: [row(ok, '1')] });
  const B = recordRun({ label: 'b', change: 'new fonts', results: [row(no, '2'), { ...row(ok, '3'), caseId: 'beat' }] });
  const c = compareRuns(A, B);
  assert.equal(c.regressed.length, 1); assert.deepEqual(c.added, ['beat/square']); assert.deepEqual(c.changedPixels, ['typography/square']);
  assert.equal(compareRuns(B, A).improved.length, 1);
});
