import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { setMatte, clearMatte, revealWipe, patchLayer } from '../lib/adLayers.js';
import { separabilityReport } from '../lib/adSeparability.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { imageIdsOf } from '../lib/adImages.js';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const mk = (layers) => { const p = JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project)); p.scenes[0].id = 's1'; p.scenes[0].params = { layers }; return p; };
const sq = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
const base = () => mk([
  { id: 'card', shape: 'rect', x: 50, y: 50, w: 40, h: 40, color: 'blue' },
  { id: 'pic', shape: 'image', imageId: 'med-pic001', x: 50, y: 50, w: 40, h: 40 },
  { id: 'words', shape: 'text', text: 'Hi', x: 50, y: 10 },
]);
function crc(buf) { let c, t = crc.t || (crc.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; }
const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type, 'latin1'), data]), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(b)); return Buffer.concat([len, b, c]); };
function png(w, h, fn) {
  const rows = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(w * 4 + 1); for (let x = 0; x < w; x++) { const [r, g, b, a] = fn(x, y); row.set([r, g, b, a], 1 + x * 4); } rows.push(row); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('matte fields validate and cross-checks give actionable errors', () => {
  assert.equal(validateProjectV2(mk([{ shape: 'rect', x: 5, y: 5, w: 5, matte: sq, matteMode: 'cut', matteFeather: 3 }])).ok, true);
  assert.equal(validateProjectV2(mk([{ shape: 'image', imageId: 'med-a001', x: 5, y: 5, w: 5, matteImage: 'med-m001', matteChannel: 'alpha' }])).ok, true);
  const r = (L) => validateProjectV2(mk([L]));
  assert.match(r({ shape: 'rect', x: 5, y: 5, w: 5, matteMode: 'cut' }).errors.join(), /need a matte polygon/);
  assert.match(r({ shape: 'rect', x: 5, y: 5, w: 5, matteChannel: 'alpha' }).errors.join(), /matteChannel needs matteImage/);
  assert.match(r({ shape: 'text', text: 'x', x: 5, y: 5, matte: sq }).errors.join(), /box layer/);
  assert.match(r({ shape: 'rect', x: 5, y: 5, w: 5, matte: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }).errors.join(), /at least 3|min|3/i);
  assert.match(r({ shape: 'rect', x: 5, y: 5, w: 5, matte: [...sq, { x: 0, y: 0, g: 1 }, { x: 1, y: 1, g: 1 }] }).errors.join(), /polygon 1 has 2/);
  assert.equal(r({ shape: 'rect', x: 5, y: 5, w: 5, keys: [{ t: 0, cropR: 50 }] }).ok, false); // crop keys are for image and video
  assert.equal(r({ shape: 'image', imageId: 'med-a001', x: 5, y: 5, w: 5, keys: [{ t: 0, cropR: 100 }, { t: 1, cropR: 0 }] }).ok, true);
  assert.equal(r({ shape: 'rect', x: 5, y: 5, w: 5, keys: [{ t: 0, mx: -100 }, { t: 1, mx: 0, ms: 2 }], matte: sq }).ok, true);
});
test('library collectors include matte images', () => {
  const p = mk([{ shape: 'rect', x: 5, y: 5, w: 5, matteImage: 'med-m001' }, { shape: 'image', imageId: 'med-a001', x: 5, y: 5, w: 5 }]);
  assert.deepEqual(imageIdsOf(p).sort(), ['med-a001', 'med-m001']);
});
test('setMatte and clearMatte', () => {
  const p = base(), a = setMatte(p, { sceneId: 's1', layerId: 'card', polygons: [sq, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]], mode: 'cut', feather: 2 });
  assert.equal(a.ok, true); const L = a.project.scenes[0].params.layers[0];
  assert.equal(L.matte.length, 7); assert.equal(L.matte[4].g, 1); assert.equal(L.matteMode, 'cut'); assert.equal(L.matteFeather, 2);
  assert.equal(setMatte(p, { sceneId: 's1', layerId: 'card', polygons: [[{ x: 1, y: 1 }]] }).ok, false);
  assert.equal(setMatte(p, { sceneId: 's1', layerId: 'words', polygons: [sq] }).ok, false);
  const c = clearMatte(a.project, { sceneId: 's1', layerId: 'card' }); assert.equal(c.ok, true); assert.equal(c.project.scenes[0].params.layers[0].matte, undefined);
});
test('revealWipe: crop keys for pictures, a sliding matte for shapes, and a held start when it begins late', () => {
  const p = base(), a = revealWipe(p, { sceneId: 's1', layerId: 'pic', direction: 'left', from: 1, duration: 2 });
  assert.equal(a.ok, true); const k = a.project.scenes[0].params.layers[1].keys;
  assert.deepEqual(k.map((q) => [q.t, q.cropR]), [[0, 100], [1, 100], [3, 0]]);
  const h = revealWipe(a.project, { sceneId: 's1', layerId: 'pic', direction: 'up', hide: true, duration: 1 });
  assert.equal(h.ok, true); const k2 = h.project.scenes[0].params.layers[1].keys; assert.ok(k2.every((q) => q.cropR === undefined)); assert.deepEqual(k2.map((q) => [q.t, q.cropB]), [[0, 0], [1, 100]]);
  const m = revealWipe(p, { sceneId: 's1', layerId: 'card', direction: 'right', duration: 1 });
  assert.equal(m.ok, true); const L = m.project.scenes[0].params.layers[0];
  assert.equal(L.matte.length, 4); assert.deepEqual(L.keys.map((q) => [q.t, q.mx]), [[0, 100], [1, 0]]);
  assert.match(revealWipe(setMatte(p, { sceneId: 's1', layerId: 'card', polygons: [sq] }).project, { sceneId: 's1', layerId: 'card' }).error, /already has its own matte/);
  assert.equal(revealWipe(p, { sceneId: 's1', layerId: 'words' }).ok, false);
  assert.equal(revealWipe(p, { sceneId: 's1', layerId: 'pic', direction: 'diagonal' }).ok, false);
  assert.equal(revealWipe(p, { sceneId: 's1', layerId: 'pic', duration: 0 }).ok, false);
});
test('separability: alpha, keyable backdrop, and flat pictures', () => {
  const hasAlpha = separabilityReport(png(20, 20, (x, y) => (x < 10 ? [200, 30, 30, 255] : [0, 0, 0, 0])));
  assert.equal(hasAlpha.verdict, 'has-alpha');
  const green = separabilityReport(png(40, 40, (x, y) => (x > 12 && x < 28 && y > 10 && y < 30 ? [200, 60, 50, 255] : [24, 190, 72, 255])));
  assert.equal(green.verdict, 'keyable'); assert.equal(green.key.mode, 'green'); assert.ok(green.key.removedPct > 50);
  const grey = separabilityReport(png(40, 40, (x, y) => (x > 12 && x < 28 && y > 10 && y < 30 ? [200, 60, 50, 255] : [120, 120, 120, 255])));
  assert.equal(grey.verdict, 'keyable'); assert.equal(grey.key.mode, 'custom'); assert.match(grey.needs, /keyColor #787878/);
  const photo = separabilityReport(png(40, 40, (x, y) => [x * 6, y * 6, (x * y) % 255, 255]));
  assert.equal(photo.verdict, 'needs-mask'); assert.match(photo.note, /cannot be recovered/);
  assert.match(separabilityReport(Buffer.from('nope')).error, /Could not read the picture/);
});
test('player carries the matte machinery and keeps the sandbox guard', () => {
  const html = readFileSync(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
  for (const s of ['matteSvg', 'applyMask', 'matteGroups', 'kcrop', 'kmat']) assert.ok(html.includes(s), s);
  assert.ok(html.includes('.slice(0,32).map(q=>({t:'), 'all 32 keyframes are kept');
});
