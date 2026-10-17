import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectV2, REGISTRY, LAYER_SHAPES, LAYER_MOTIONS, LAYER_COLORS } from '../public/ad-vocabulary.mjs';

const arc = (i, color, r) => ({ shape: 'arc', x: 50, y: 60, w: r, thickness: 3, color, motion: 'draw', delay: i * 0.2 });
const rainbow = () => ({
  specVersion: 2,
  name: 'Rainbow test',
  mood: 'playful',
  palette: 'electric-pop',
  platform: { format: 'portrait', lengthSec: 6 },
  scenes: [
    {
      id: 'bow', type: 'graphic', duration: 4, background: 'solid',
      params: {
        layers: [
          arc(0, 'red', 40), arc(1, 'orange', 36), arc(2, 'yellow', 32), arc(3, 'green', 28),
          arc(4, 'blue', 24), arc(5, 'violet', 20), arc(6, 'pink', 16),
          { shape: 'circle', x: 18, y: 66, w: 14, color: 'white', motion: 'drift' },
          { shape: 'text', x: 50, y: 84, text: 'Hello', size: 9, color: 'text', motion: 'pop', delay: 1.2 },
        ],
      },
    },
    { id: 'end', type: 'end_card', duration: 2, params: { cta: 'Try it' } },
  ],
});

test('graphic is registered with bounded layers', () => {
  const g = REGISTRY.sceneTypes.find((t) => t.id === 'graphic');
  assert.ok(g);
  assert.equal(g.params.layers.kind, 'items');
  assert.equal(g.params.layers.min, 1);
  assert.equal(g.params.layers.max, 16);
  assert.deepEqual(Object.keys(g.params.layers.fields).sort(), ['color', 'delay', 'h', 'imageId', 'motion', 'shape', 'size', 'text', 'thickness', 'w', 'x', 'y']);
});

test('a rainbow graphic project validates', () => {
  const r = validateProjectV2(rainbow());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.value.scenes[0].params.layers.length, 9);
});

test('layers reject raw svg, unknown fields and unknown ids', () => {
  const bad = rainbow();
  bad.scenes[0].params.layers[0].svg = '<svg onload=alert(1)></svg>';
  const r = validateProjectV2(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('svg') && e.includes('unknown field')));

  for (const [field, value] of [['shape', 'star'], ['motion', 'spin'], ['color', 'chartreuse']]) {
    const p = rainbow();
    p.scenes[0].params.layers[0][field] = value;
    assert.equal(validateProjectV2(p).ok, false, `${field}=${value} must be rejected`);
  }
});

test('layer count, position and required fields are enforced', () => {
  const none = rainbow();
  none.scenes[0].params.layers = [];
  assert.equal(validateProjectV2(none).ok, false);

  const many = rainbow();
  many.scenes[0].params.layers = Array.from({ length: 17 }, () => ({ shape: 'circle', x: 10, y: 10, w: 5 }));
  assert.equal(validateProjectV2(many).ok, false);

  const off = rainbow();
  off.scenes[0].params.layers[0].x = 140;
  assert.equal(validateProjectV2(off).ok, false);

  const noShape = rainbow();
  delete noShape.scenes[0].params.layers[0].shape;
  assert.equal(validateProjectV2(noShape).ok, false);

  const noLayers = rainbow();
  delete noLayers.scenes[0].params.layers;
  assert.equal(validateProjectV2(noLayers).ok, false);
});

test('exported layer vocab lists are the ones the schema accepts', () => {
  for (const shape of LAYER_SHAPES) for (const motion of LAYER_MOTIONS.slice(0, 2)) {
    const p = rainbow();
    p.scenes[0].params.layers = [{ shape, x: 50, y: 50, w: 10, h: 10, motion, color: LAYER_COLORS[0] }];
    assert.equal(validateProjectV2(p).ok, true, `${shape}/${motion}`);
  }
});
