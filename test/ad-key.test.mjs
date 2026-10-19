import test from 'node:test';
import assert from 'node:assert/strict';
import { keyFrame, overBackground, KEY_PRESETS } from '../public/ad-key.mjs';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const G = KEY_PRESETS.green;
// A strip: left third pure screen, middle a ramp of subject (red) mixed with the screen, right third solid subject.
function strip(w = 60, h = 6, F = [220, 40, 40], K = G) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = x < 20 ? 0 : x >= 40 ? 1 : (x - 20) / 20, i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) d[i + c] = F[c] * a + K[c] * (1 - a);
    d[i + 3] = 255;
  }
  return d;
}
const alphaAt = (o, w, x, y = 3) => o[(y * w + x) * 4 + 3];

test('green key: screen goes transparent, subject stays solid, edge ramps between', () => {
  const o = keyFrame(strip(), 60, 6, { key: 'green', tol: 15, soft: 40 });
  assert.equal(alphaAt(o, 60, 5), 0); assert.equal(alphaAt(o, 60, 55), 255);
  const ramp = [22, 26, 30, 34].map((x) => alphaAt(o, 60, x));
  assert.ok(ramp.every((v, i) => i === 0 || v >= ramp[i - 1]), 'monotonic ' + ramp);
});
test('translucent edges: recompositing over the screen colour returns the source (premultiplied maths)', () => {
  const src = strip(), o = keyFrame(src, 60, 6, { key: 'green', tol: 0, soft: 70 }), back = overBackground(o, G);
  let err = 0; for (let x = 20; x < 40; x++) for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(back[(3 * 60 + x) * 4 + c] - src[(3 * 60 + x) * 4 + c]));
  assert.ok(err <= 10, 'max error ' + err); // within about 4 percent
});
test('blue and custom keys', () => {
  const B = KEY_PRESETS.blue, ob = keyFrame(strip(60, 6, [230, 200, 40], B), 60, 6, { key: 'blue', tol: 20, soft: 30 });
  assert.equal(alphaAt(ob, 60, 5), 0); assert.equal(alphaAt(ob, 60, 55), 255);
  const M = [200, 30, 200], oc = keyFrame(strip(60, 6, [40, 200, 40], M), 60, 6, { key: 'custom', color: '#c81ec8', tol: 20, soft: 30 });
  assert.equal(alphaAt(oc, 60, 5), 0); assert.equal(alphaAt(oc, 60, 55), 255);
});
test('uneven lighting: a darker screen still keys', () => {
  const dark = new Uint8ClampedArray(16 * 4); for (let i = 0; i < 16; i++) { dark[i * 4] = 17; dark[i * 4 + 1] = 135; dark[i * 4 + 2] = 51; dark[i * 4 + 3] = 255; }
  assert.equal(keyFrame(dark, 4, 4, { key: 'green', tol: 20, soft: 20 })[3], 0);
});
test('matte grow, shrink and feather change the edge as asked', () => {
  const base = keyFrame(strip(), 60, 6, { key: 'green', tol: 15, soft: 5 });
  const area = (o) => { let s = 0; for (let i = 3; i < o.length; i += 4) s += o[i]; return s; };
  const grown = keyFrame(strip(), 60, 6, { key: 'green', tol: 15, soft: 5, grow: 3 }), shrunk = keyFrame(strip(), 60, 6, { key: 'green', tol: 15, soft: 5, grow: -3 });
  assert.ok(area(grown) > area(base) && area(base) > area(shrunk));
  const soft = keyFrame(strip(), 60, 6, { key: 'green', tol: 15, soft: 5, feather: 4 }), mids = (o) => [...Array(60).keys()].filter((x) => { const a = alphaAt(o, 60, x); return a > 10 && a < 245; }).length;
  assert.ok(mids(soft) > mids(base));
});
test('spill suppression pulls a green cast off the subject', () => {
  const px = new Uint8ClampedArray([200, 170, 120, 255]); // skin lit green
  const off = keyFrame(px, 1, 1, { key: 'green', tol: 5, soft: 5, spill: 0 }), on = keyFrame(px, 1, 1, { key: 'green', tol: 5, soft: 5, spill: 100 });
  assert.ok(on[1] < off[1]); assert.equal(on[0], off[0]);
});
test('views: original is untouched, matte is grey, foreground is opaque, final carries alpha; source alpha is respected', () => {
  const src = strip(), n = 60 * 6;
  const orig = keyFrame(src, 60, 6, { key: 'green', view: 'original' }); assert.deepEqual([...orig.slice(0, 8)], [...src.slice(0, 8)]);
  const m = keyFrame(src, 60, 6, { key: 'green', tol: 15, soft: 20, view: 'matte' }), f = keyFrame(src, 60, 6, { key: 'green', tol: 15, soft: 20, view: 'foreground' });
  for (let p = 0; p < n; p++) { assert.equal(m[p * 4], m[p * 4 + 1]); assert.equal(m[p * 4 + 3], 255); assert.equal(f[p * 4 + 3], 255); }
  const half = new Uint8ClampedArray([220, 40, 40, 128]); assert.equal(keyFrame(half, 1, 1, { key: 'green', tol: 15, soft: 20 })[3], 128);
});
test('deterministic: identical input gives identical output', () => {
  const a = keyFrame(strip(), 60, 6, { key: 'green', tol: 15, soft: 20, feather: 2, grow: 1, spill: 50 }), b = keyFrame(strip(), 60, 6, { key: 'green', tol: 15, soft: 20, feather: 2, grow: 1, spill: 50 });
  assert.deepEqual([...a], [...b]);
});
test('vocabulary: key fields validate and misuse names the layer', () => {
  const mk = (layers) => { const p = JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project)); p.scenes[0].params = { layers }; return p; };
  const img = { shape: 'image', imageId: 'med-green001', x: 50, y: 50, w: 50, h: 50 };
  assert.equal(validateProjectV2(mk([{ ...img, key: 'green', keyTol: 20, keySoft: 10, keyFeather: 2, keyGrow: -1, keySpill: 40, keyView: 'matte' }])).ok, true);
  assert.match(validateProjectV2(mk([{ shape: 'circle', x: 5, y: 5, w: 5, key: 'green' }])).errors.join(' '), /layers\[0\]\.key: only image and video/);
  assert.match(validateProjectV2(mk([{ ...img, key: 'custom' }])).errors.join(' '), /keyColor/);
  assert.equal(validateProjectV2(mk([{ ...img, key: 'custom', keyColor: '#12ab34' }])).ok, true);
  assert.match(validateProjectV2(mk([{ ...img, keyTol: 10 }])).errors.join(' '), /key settings need key/);
  assert.equal(validateProjectV2(mk([{ ...img, key: 'green', keyTol: 101 }])).ok, false);
});
