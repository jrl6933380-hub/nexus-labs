import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { selectionColors, parseHex } from '../public/ad-select.mjs';
import { decodePng } from '../lib/pngDecode.js';
import { selectionReport, pickAt, findInLegend } from '../lib/adSelect.js';

// A tiny PNG encoder so the decoder is tested against every filter type, without a native image library.
function crc(buf) { let c, t = crc.t || (crc.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; }
const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type, 'latin1'), data]), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(b)); return Buffer.concat([len, b, c]); };
function png(w, h, rgba, filters = [0]) {
  const rows = [], stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = filters[y % filters.length], row = Buffer.alloc(stride + 1); row[0] = f;
    for (let x = 0; x < stride; x++) {
      const v = rgba[y * stride + x], a = x >= 4 ? rgba[y * stride + x - 4] : 0, up = y ? rgba[(y - 1) * stride + x] : 0, ul = y && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
      let pred = 0; if (f === 1) pred = a; else if (f === 2) pred = up; else if (f === 3) pred = (a + up) >> 1; else if (f === 4) { const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul); pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      row[x + 1] = (v - pred) & 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('selection colours: unique, never grey, deterministic, and keyed to the id', () => {
  const ids = Array.from({ length: 300 }, (_, i) => `layer-${i}`), a = selectionColors(ids), b = selectionColors(ids);
  assert.deepEqual(a, b); assert.equal(new Set(a).size, 300);
  for (const h of a) { const [r, g, bl] = parseHex(h); assert.ok(!(r === g && g === bl), 'grey ' + h); }
  // the same id keeps its colour when other ids come and go (unless a collision was resolved)
  const s1 = selectionColors(['layer-5', 'layer-77', 'layer-200']), s2 = selectionColors(['layer-5', 'layer-77', 'layer-200', 'x1', 'x2']);
  assert.deepEqual(s2.slice(0, 3), s1);
  // big scenes switch to a finer palette and stay unique
  const many = Array.from({ length: 2048 }, (_, i) => `l${i}`), m = selectionColors(many);
  assert.equal(new Set(m).size, 2048);
  // order of the input does not change an id's colour
  const rev = selectionColors([...ids].reverse()); assert.deepEqual([...rev].reverse(), a);
});
test('PNG decoder reads every filter type', () => {
  const w = 7, h = 6, px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 3) * 11) & 255;
  const r = decodePng(png(w, h, px, [0, 1, 2, 3, 4]));
  assert.equal(r.width, 7); assert.equal(r.height, 6); assert.deepEqual([...r.rgba], [...px]);
  assert.throws(() => decodePng(Buffer.from('nope')), /not a PNG/);
});
test('selection report and pick', () => {
  const legend = [{ id: 'hero', color: '#ff0000', name: 'Blue character', role: 'subject' }, { id: 'prod', color: '#00ff00', role: 'product' }, { id: 'ghost', color: '#0000ff' }];
  const w = 20, h = 10, px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) px[i * 4 + 3] = 255;
  const paint = (x0, x1, c) => { for (let y = 2; y < 8; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } };
  paint(2, 8, [255, 0, 0]); paint(12, 18, [0, 255, 0]);
  const i = (5 * w + 8) * 4; px[i] = 128; px[i + 1] = 128; px[i + 2] = 128; // an antialiased grey pixel is ignored
  const rep = selectionReport(png(w, h, px), legend);
  const hero = rep.layers[0], ghost = rep.layers[2];
  assert.equal(hero.pixels, 36); // the grey pixel at x=8 is outside the block and ignored
  assert.equal(hero.visible, true); assert.deepEqual(hero.bboxPct, { left: 10, top: 20, right: 40, bottom: 80 }); assert.equal(ghost.visible, false); assert.equal(ghost.bboxPct, null);
  assert.equal(rep.layers[1].coveragePct, 18);
  assert.equal(pickAt(png(w, h, px), legend, 25, 50).id, 'hero');
  assert.equal(pickAt(png(w, h, px), legend, 75, 50).id, 'prod');
  assert.equal(pickAt(png(w, h, px), legend, 50, 50, { radius: 1 }).id, null);
  assert.deepEqual(findInLegend([{ id: 'a', name: 'Blue character', role: 'subject', color: 'blue' }, { id: 'b', name: 'Red product', role: 'product', color: 'red' }], { color: 'blue' }), ['a']);
});
