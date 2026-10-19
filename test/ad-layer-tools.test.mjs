import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLayerEdits, readAdLayers, layerEditSchema } from '../lib/adLayerTools.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const mk = (layers) => { const p = JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project)); p.scenes[0].id = 's1'; p.scenes[0].params = { layers }; return p; };
const base = () => mk([
  { id: 'bg', name: 'Sky', role: 'background', shape: 'rect', x: 50, y: 50, w: 100, h: 100, color: 'blue' },
  { id: 'pic', name: 'Subject', role: 'subject', shape: 'image', imageId: 'med-green001', x: 50, y: 50, w: 50, h: 50 },
  { shape: 'circle', x: 5, y: 5, w: 5 },
]);

test('read: lists graphic scenes, layers, one layer, and finds', () => {
  const p = base();
  assert.equal(readAdLayers(p, { campaign_id: 'c' }).graphic_scenes[0].anonymous, 1);
  assert.equal(readAdLayers(p, { campaign_id: 'c', scene_id: 's1' }).count, 3);
  assert.equal(readAdLayers(p, { campaign_id: 'c', scene_id: 's1', layer_id: 'pic' }).ok, true);
  assert.deepEqual(readAdLayers(p, { campaign_id: 'c', scene_id: 's1', find: { role: 'subject' } }).matches.map((m) => m.id), ['pic']);
  assert.throws(() => readAdLayers(p, { campaign_id: 'c', scene_id: 'nope' }));
});
test('edits apply in order, atomically, and stay valid', () => {
  const p = base();
  const r = applyLayerEdits(p, { scene_id: 's1', edits: [
    { op: 'set_key', layer_id: 'pic', key: 'green', tolerance: 30, spill: 50 },
    { op: 'set_matte', layer_id: 'pic', polygons: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }]], mode: 'keep', feather: 2 },
    { op: 'reveal_wipe', layer_id: 'pic', direction: 'left', duration: 1 },
    { op: 'add', layer: { shape: 'circle', x: 20, y: 20, w: 8, color: 'red', name: 'Dot' } },
    { op: 'group', ids: ['pic'], group_id: 'grp' },
  ] });
  assert.equal(validateProjectV2(r.project).ok, true);
  const pic = r.project.scenes[0].params.layers.find((l) => l.id === 'pic');
  assert.equal(pic.key, 'green'); assert.equal(pic.keyTol, 30); assert.ok(pic.matte); assert.equal(pic.parent, 'grp');
  assert.equal(p.scenes[0].params.layers[1].key, undefined);
  assert.ok(r.changes.some((c) => /gave ids/.test(c)));
  assert.ok(r.project.scenes[0].params.layers.every((l) => l.id));
  const c = applyLayerEdits(r.project, { scene_id: 's1', edits: [{ op: 'clear_key', layer_id: 'pic' }, { op: 'clear_matte', layer_id: 'pic' }] });
  assert.equal(c.project.scenes[0].params.layers.find((l) => l.id === 'pic').key, undefined);
});
test('a failing edit names its index and changes nothing', () => {
  const p = base();
  assert.throws(() => applyLayerEdits(p, { scene_id: 's1', edits: [{ op: 'patch', layer_id: 'bg', patch: { x: 40 } }, { op: 'patch', layer_id: 'ghost', patch: { x: 1 } }] }), /Edit 2 \(patch\)/);
  assert.throws(() => applyLayerEdits(p, { scene_id: 's1', edits: [{ op: 'set_key', layer_id: 'bg', key: 'green' }] }), /Edit 1/);
  assert.throws(() => applyLayerEdits(p, { scene_id: 'zzz', edits: [{ op: 'remove', layer_id: 'bg' }] }), /not a graphic scene/);
  assert.throws(() => applyLayerEdits(p, { scene_id: 's1', edits: [{ op: 'explode', layer_id: 'bg' }] }), /Invalid layer edit/);
});
test('schema caps edits at 20 and rejects unknown fields', () => {
  const one = { op: 'remove', layer_id: 'bg' };
  assert.equal(layerEditSchema.safeParse({ campaign_id: 'c', scene_id: 's1', edits: Array(21).fill(one) }).success, false);
  assert.equal(layerEditSchema.safeParse({ campaign_id: 'c', scene_id: 's1', edits: [one], extra: 1 }).success, false);
  assert.equal(layerEditSchema.safeParse({ campaign_id: 'c', scene_id: 's1', edits: [one] }).success, true);
});

test('anonymous layers are addressable on read without saving, including hash-guarded edits', () => {
  const p = base(), before = JSON.stringify(p);
  const list = readAdLayers(p, { scene_id: 's1' });
  const row = list.layers[2];
  assert.equal(list.generated_ids, 1);
  assert.equal(list.unaddressable, 0);
  assert.equal(row.id, 'circle-3');
  assert.equal(row.name, 'circle-3');
  const one = readAdLayers(p, { scene_id: 's1', layer_id: row.id });
  assert.equal(one.hash, row.hash);
  assert.equal(readAdLayers(p, { scene_id: 's1', find: { shape: 'circle' } }).matches[0].id, row.id);
  const edited = applyLayerEdits(p, { scene_id: 's1', edits: [
    { op: 'patch', layer_id: row.id, baseline: row.hash, patch: { x: 20, role: 'prop' } },
  ] });
  assert.equal(edited.project.scenes[0].params.layers[2].x, 20);
  assert.equal(JSON.stringify(p), before, 'reads and preview edits leave the source unchanged');
  assert.equal(readAdLayers(p, { scene_id: 's1' }).layers[2].id, row.id);
  assert.throws(() => readAdLayers(p, { scene_id: 'missing' }), /not a graphic scene/);
});
