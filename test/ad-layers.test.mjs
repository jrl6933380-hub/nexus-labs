import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureIds, listLayers, readLayer, selectLayers, patchLayer, groupLayers, ungroup, reorderLayer, removeLayer, duplicateLayer, replaceAsset, saveComposition, placeComposition, layerHash } from '../lib/adLayers.js';
import { validateProjectV2, graphicCost, GRAPHIC_BUDGET, GRAPHIC_MAX_LAYERS, GRAPHIC_MAX_SHAPES } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const mk = (layers) => { const p = JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project)); p.scenes[0].id = 's1'; p.scenes[0].params = { layers }; return p; };
const base = () => mk([
  { id: 'bg', name: 'Sky', role: 'background', shape: 'rect', x: 50, y: 50, w: 100, h: 100, color: 'blue' },
  { id: 'hero', name: 'Blue character', role: 'subject', shape: 'circle', x: 30, y: 60, w: 20, color: 'blue' },
  { id: 'prod', name: 'Red product', role: 'product', shape: 'rect', x: 70, y: 60, w: 14, h: 14, color: 'red' },
  { id: 'head', name: 'Headline', role: 'text', shape: 'text', text: 'Hello', x: 50, y: 15, size: 8 },
]);

test('new layer fields validate; limit is 2048 layers; cost is advisory', () => {
  assert.equal(validateProjectV2(mk([{ shape: 'circle', x: 5, y: 5, w: 5, name: 'a', role: 'subject', visible: false, locked: true, z: 3, sx: 2, sy: 0.5, pivotX: 0, pivotY: 100, cropL: 10, cropT: 5, trate: 2, toffset: 1, tloop: 3 }])).ok, true);
  assert.equal(validateProjectV2(mk([{ shape: 'circle', x: 5, y: 5, role: 'wizard' }])).ok, false);
  assert.equal(validateProjectV2(mk(Array.from({ length: GRAPHIC_MAX_LAYERS }, () => ({ shape: 'circle', x: 5, y: 5, w: 3 })))).ok, true);
  const heavy = Array.from({ length: 200 }, (_, i) => ({ id: 'h' + i, name: 'glow ' + i, shape: 'circle', x: 5, y: 5, w: 3, glow: 3 }));
  assert.equal(validateProjectV2(mk(heavy)).ok, true); // heavy scenes are allowed; the cost is advice only
  assert.ok(graphicCost(heavy) > GRAPHIC_BUDGET.max);
  assert.equal(listLayers(mk(heavy), 's1').overWarn, true);
});
test('list, read and select give stable ids; ensureIds names anonymous layers', () => {
  const p = base(), l = listLayers(p, 's1');
  assert.equal(l.count, 4); assert.equal(l.layers[1].role, 'subject'); assert.ok(l.layers.every((r) => r.hash.length === 12));
  assert.deepEqual(selectLayers(p, 's1', { color: 'blue', role: 'subject' }).matches.map((m) => m.id), ['hero']);
  assert.deepEqual(selectLayers(p, 's1', { name: 'product' }).matches.map((m) => m.id), ['prod']);
  const anon = ensureIds(mk([{ shape: 'circle', x: 1, y: 1 }, { shape: 'text', text: 'Hi', x: 2, y: 2 }]));
  assert.deepEqual(anon.scenes[0].params.layers.map((x) => x.id), ['circle-1', 'text-2']); assert.equal(anon.scenes[0].params.layers[1].name, 'Hi');
  assert.equal(listLayers(p, 'nope').ok, false);
  assert.equal(readLayer(p, 's1', 'zzz').ok, false);
});
test('patching is validated, baseline-aware and respects locks', () => {
  const p = base(), h = readLayer(p, 's1', 'hero').hash;
  const a = patchLayer(p, { sceneId: 's1', layerId: 'hero', patch: { x: 40, glow: 2 }, baseline: h });
  assert.equal(a.ok, true); assert.equal(a.project.scenes[0].params.layers[1].x, 40); assert.equal(p.scenes[0].params.layers[1].x, 30);
  const stale = patchLayer(a.project, { sceneId: 's1', layerId: 'hero', patch: { x: 50 }, baseline: h });
  assert.equal(stale.ok, false); assert.match(stale.error, /changed since you read it/); assert.ok(stale.current);
  const bad = patchLayer(p, { sceneId: 's1', layerId: 'hero', patch: { w: 999 } });
  assert.equal(bad.ok, false); assert.match(bad.error, /scene "s1" layer "hero"/);
  const locked = patchLayer(p, { sceneId: 's1', layerId: 'hero', patch: { locked: true } }).project;
  assert.equal(patchLayer(locked, { sceneId: 's1', layerId: 'hero', patch: { x: 1 } }).ok, false);
  assert.equal(patchLayer(locked, { sceneId: 's1', layerId: 'hero', patch: { locked: false } }).ok, true);
  assert.equal(patchLayer(p, { sceneId: 's1', layerId: 'hero', patch: { id: 'x' } }).ok, false);
  assert.equal(patchLayer(p, { sceneId: 's1', layerId: 'hero', patch: { color: null } }).ok, true);
});
test('group, ungroup, reorder, remove, duplicate keep the ad valid', () => {
  const p = base();
  const g = groupLayers(p, { sceneId: 's1', ids: ['hero', 'prod'], groupId: 'duo', name: 'Duo', role: 'subject' });
  assert.equal(g.ok, true);
  const ids = g.project.scenes[0].params.layers.map((l) => l.id); assert.deepEqual(ids, ['bg', 'duo', 'hero', 'prod', 'head']);
  assert.equal(g.project.scenes[0].params.layers[2].parent, 'duo');
  assert.equal(groupLayers(p, { sceneId: 's1', ids: ['hero', 'nope'], groupId: 'x' }).ok, false);
  const u = ungroup(g.project, { sceneId: 's1', groupId: 'duo' });
  assert.equal(u.ok, true); assert.equal(u.project.scenes[0].params.layers.find((l) => l.id === 'hero').parent, undefined);
  const moving = patchLayer(g.project, { sceneId: 's1', layerId: 'duo', patch: { rotate: 10 } }).project;
  assert.equal(ungroup(moving, { sceneId: 's1', groupId: 'duo' }).ok, false);
  const r = reorderLayer(g.project, { sceneId: 's1', layerId: 'duo', toIndex: 0 });
  assert.equal(r.ok, true); assert.deepEqual(r.project.scenes[0].params.layers.map((l) => l.id).slice(0, 3), ['duo', 'hero', 'prod']);
  assert.equal(removeLayer(g.project, { sceneId: 's1', layerId: 'duo' }).ok, false);
  assert.equal(removeLayer(g.project, { sceneId: 's1', layerId: 'duo', withChildren: true }).project.scenes[0].params.layers.length, 2);
  const d = duplicateLayer(g.project, { sceneId: 's1', layerId: 'duo', prefix: 'b-', dx: 5 });
  assert.equal(d.ok, true); assert.deepEqual(d.newIds, ['b-duo', 'b-hero', 'b-prod']);
  assert.equal(d.project.scenes[0].params.layers.find((l) => l.id === 'b-hero').parent, 'b-duo');
  assert.equal(duplicateLayer(d.project, { sceneId: 's1', layerId: 'duo', prefix: 'b-' }).ok, false);
});
test('replace an asset and reuse a composition', () => {
  const p = mk([{ id: 'bg', shape: 'image', imageId: 'med-sky001', x: 50, y: 50, w: 100, h: 100 }, { id: 'a', shape: 'circle', x: 5, y: 5, w: 5 }]);
  assert.equal(replaceAsset(p, { sceneId: 's1', layerId: 'bg', imageId: 'med-sky002' }).project.scenes[0].params.layers[0].imageId, 'med-sky002');
  assert.equal(replaceAsset(p, { sceneId: 's1', layerId: 'a', imageId: 'med-sky002' }).ok, false);
  const g = groupLayers(base(), { sceneId: 's1', ids: ['hero', 'prod'], groupId: 'duo' }).project;
  const comp = saveComposition(g, { sceneId: 's1', groupId: 'duo' }).composition;
  assert.equal(comp.layers.length, 3);
  const placed = placeComposition(base(), { sceneId: 's1', composition: comp, prefix: 'n-', x: 10, y: 10 });
  assert.equal(placed.ok, true); assert.equal(placed.project.scenes[0].params.layers.find((l) => l.id === 'n-duo').x, 10);
  assert.equal(placeComposition(placed.project, { sceneId: 's1', composition: comp, prefix: 'n-' }).ok, false);
  assert.equal(layerHash({ a: 1, b: 2 }), layerHash({ b: 2, a: 1 }));
});
test('player caps match the vocabulary limits', () => {
  const html = readFileSync(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
  assert.ok(html.includes('.slice(0,' + GRAPHIC_MAX_LAYERS + ')'), 'layer slice');
  assert.ok(html.includes('MAXN=' + GRAPHIC_MAX_SHAPES), 'shape cap');
});
import { keyViews } from '../lib/adLayers.js';
test('keyViews makes one project per view and refuses an unkeyed layer', () => {
  const p = mk([{ id: 'pic', shape: 'image', imageId: 'med-green001', x: 50, y: 50, w: 50, h: 50, key: 'green' }, { id: 'dot', shape: 'circle', x: 5, y: 5, w: 5 }]);
  const r = keyViews(p, { sceneId: 's1', layerId: 'pic' });
  assert.equal(r.ok, true); assert.deepEqual(Object.keys(r.views), ['final', 'original', 'foreground', 'matte']);
  assert.equal(r.views.matte.scenes[0].params.layers[0].keyView, 'matte'); assert.equal(p.scenes[0].params.layers[0].keyView, undefined);
  assert.match(keyViews(p, { sceneId: 's1', layerId: 'dot' }).error, /not keyed/);
});
