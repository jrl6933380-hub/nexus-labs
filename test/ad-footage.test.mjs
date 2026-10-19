import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShot, shotLayer, shotsToScenes, shotList } from '../lib/adShots.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { pickImages } from '../lib/adExport.js';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const base = () => JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project));
const withLayers = (layers) => { const p = base(); p.scenes[0].params = { layers }; return validateProjectV2(p); };

test('video layers validate: trim, rate, repeat, focus; bad values are rejected', () => {
  assert.equal(withLayers([{ shape: 'video', imageId: 'med-clip01', x: 50, y: 50, w: 80, h: 40, trimIn: 1, trimOut: 4, rate: 1.5, repeat: true, focusX: 30, focusY: 60 }]).ok, true);
  for (const bad of [{ rate: 9 }, { rate: 0.1 }, { trimIn: -1 }, { focusX: 120 }, { repeat: 'yes' }]) assert.equal(withLayers([{ shape: 'video', imageId: 'med-clip01', x: 50, y: 50, ...bad }]).ok, false, JSON.stringify(bad));
});
test('shots validate and report problems', () => {
  assert.equal(validateShot({ mediaId: 'med-clip01', trimIn: 1, trimOut: 4 }).value.seconds, 3);
  assert.equal(validateShot({ mediaId: 'bad id' }).ok, false);
  assert.equal(validateShot({ mediaId: 'med-clip01', trimIn: 4, trimOut: 2 }).ok, false);
  assert.equal(validateShot({ mediaId: 'med-clip01', framing: 'huge' }).ok, false);
  assert.equal(validateShot({ mediaId: 'med-clip01', rate: 2, trimIn: 0, trimOut: 4 }).value.seconds, 2);
});
test('shotsToScenes makes valid scenes with fixed captions and logos independent of the camera', () => {
  const scenes = shotsToScenes([{ mediaId: 'med-clip01', trimOut: 3, caption: 'Same-day service', framing: 'wide' }, { mediaId: 'med-clip02', seconds: 2, framing: 'close' }], { logoId: 'med-logo1' });
  assert.equal(scenes.length, 2);
  for (const s of scenes) for (const l of s.params.layers.filter((l) => l.shape === 'text' || l.shape === 'image')) assert.equal(l.fixed, true);
  const p = base(); p.scenes = [...scenes, p.scenes[p.scenes.length - 1]];
  assert.equal(validateProjectV2(p).ok, true, JSON.stringify(validateProjectV2(p).errors));
  assert.throws(() => shotsToScenes([]));
  assert.equal(shotLayer(validateShot({ mediaId: 'med-clip01', focus: { x: 20, y: 70 } })).focusX, 20);
});
test('shotList gives start times without decoding video', () => {
  const l = shotList([{ mediaId: 'med-clip01', seconds: 2 }, { mediaId: 'med-clip02', seconds: 3 }, { mediaId: 'x' }]);
  assert.equal(l[1].startSec, 2); assert.equal(l[2].ok, false);
});
test('exporter accepts clips as media ids and still rejects other data', () => {
  const p = { scenes: [{ type: 'photo_focus', params: { imageId: 'med-clip01' } }] };
  const ok = pickImages(p, { 'med-clip01': { src: 'data:video/webm;base64,AAAA', source: 'uploaded' } });
  assert.ok(ok['med-clip01']);
  assert.throws(() => pickImages(p, { 'med-clip01': { src: 'data:text/html;base64,AAAA' } }));
});
