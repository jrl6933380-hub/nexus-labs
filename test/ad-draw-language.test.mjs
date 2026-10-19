import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectV2, PATH_COMMANDS, LAYER_CLIPS, LAYER_MASKS, PATH_MAX_SEGMENTS } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const proj = (layer) => ({ ...GRAPHIC_DEMOS.paths.project, scenes: [{ id: 's', type: 'graphic', duration: 3, params: { layers: [layer] } }, GRAPHIC_DEMOS.paths.project.scenes[0]].map((x, i) => ({ ...x, id: 's' + i })) });
const ok = (layer) => validateProjectV2(proj(layer));
const tri = [{ c: 'M', x: 10, y: 10 }, { c: 'L', x: 90, y: 10 }, { c: 'L', x: 50, y: 90 }, { c: 'Z' }];

test('exports the drawing vocabulary', () => {
  assert.deepEqual(PATH_COMMANDS, ['M', 'L', 'Q', 'C', 'Z']);
  assert.ok(LAYER_CLIPS.includes('rounded') && LAYER_MASKS.includes('fade_bottom'));
  assert.equal(PATH_MAX_SEGMENTS, 64);
});
test('demo project is valid', () => assert.equal(validateProjectV2(GRAPHIC_DEMOS.paths.project).ok, true));
test('a path layer validates', () => assert.equal(ok({ shape: 'path', x: 50, y: 50, w: 20, d: tri }).ok, true));
test('bad command, too many segments, out-of-range coords are rejected', () => {
  assert.equal(ok({ shape: 'path', x: 50, y: 50, w: 20, d: [{ c: 'M', x: 0, y: 0 }, { c: 'X', x: 1, y: 1 }] }).ok, false);
  const many = Array.from({ length: PATH_MAX_SEGMENTS + 1 }, (_, i) => ({ c: i ? 'L' : 'M', x: i, y: i }));
  assert.equal(ok({ shape: 'path', x: 50, y: 50, w: 20, d: many }).ok, false);
  assert.equal(ok({ shape: 'path', x: 50, y: 50, w: 20, d: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 900, y: 1 }] }).ok, false);
});
test('unknown clip and mask are rejected, known ones pass', () => {
  assert.equal(ok({ shape: 'group', x: 50, y: 50, clip: 'star' }).ok, false);
  assert.equal(ok({ shape: 'group', x: 50, y: 50, mask: 'blur' }).ok, false);
  for (const clip of LAYER_CLIPS) assert.equal(ok({ shape: 'group', x: 50, y: 50, clip }).ok, true);
  for (const mask of LAYER_MASKS) assert.equal(ok({ shape: 'group', x: 50, y: 50, mask }).ok, true);
});
test('extended blends and isolate pass', () => {
  for (const blend of ['lighten', 'darken', 'color-dodge', 'soft-light', 'hard-light', 'difference', 'exclusion']) assert.equal(ok({ shape: 'circle', x: 50, y: 50, w: 10, blend, isolate: true }).ok, true);
});
