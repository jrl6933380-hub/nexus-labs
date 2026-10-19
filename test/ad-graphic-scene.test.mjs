import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProjectV2, REGISTRY, LAYER_SHAPES, LAYER_MOTIONS, LAYER_COLORS, LAYER_ORIGINS, KEY_EASINGS, GRAPHIC_MAX_SHAPES, LAYER_REVEALS, LAYER_BLENDS, IMAGE_FITS,
} from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

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
const withLayers = (layers, extra = {}) => {
  const p = rainbow();
  p.scenes[0].params = { layers, ...extra };
  return p;
};
const ok = (p) => validateProjectV2(p);

test('graphic is registered with bounded layers and the full field set', () => {
  const g = REGISTRY.sceneTypes.find((t) => t.id === 'graphic');
  assert.ok(g);
  assert.equal(g.params.layers.kind, 'items');
  assert.equal(g.params.layers.min, 1);
  assert.equal(g.params.layers.max, 512);
  assert.deepEqual(Object.keys(g.params).sort(), ['audioHigh', 'audioLow', 'audioMid', 'audioRate', 'beatOffset', 'beatShake', 'beatZoom', 'bpm', 'camera', 'hits', 'layers']);
  for (const f of ['shape', 'id', 'parent', 'x', 'y', 'x2', 'y2', 'rotate', 'scale', 'opacity', 'origin', 'keys', 'count', 'emit', 'glow', 'blur', 'color2', 'sides', 'weight', 'spacing', 'caps', 'maxw', 'reveal', 'revealStep', 'stroke', 'strokeW', 'shadow', 'radius', 'fit', 'blend', 'fixed', 'loop']) {
    assert.ok(g.params.layers.fields[f], `layer field ${f}`);
  }
});

test('a rainbow graphic project still validates (backward compatible)', () => {
  const r = ok(rainbow());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.value.scenes[0].params.layers.length, 9);
});

test('layers reject raw svg, unknown fields and unknown ids', () => {
  const bad = rainbow();
  bad.scenes[0].params.layers[0].svg = '<svg onload=alert(1)></svg>';
  const r = ok(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('svg') && e.includes('unknown field')));

  for (const [field, value] of [['shape', 'blob'], ['motion', 'explode'], ['color', 'chartreuse'], ['origin', 'middle'], ['color2', 'teal']]) {
    const p = rainbow();
    p.scenes[0].params.layers[0][field] = value;
    assert.equal(ok(p).ok, false, `${field}=${value} must be rejected`);
  }
});

test('layer count, position and required fields are enforced', () => {
  assert.equal(ok(withLayers([])).ok, false);
  assert.equal(ok(withLayers(Array.from({ length: 513 }, () => ({ shape: 'circle', x: 10, y: 10, w: 5 })))).ok, false);
  assert.equal(ok(withLayers(Array.from({ length: 512 }, () => ({ shape: 'circle', x: 10, y: 10, w: 5 })))).ok, true);
  assert.equal(ok(withLayers([{ shape: 'circle', x: 140, y: 10, w: 5 }])).ok, true, 'off-frame positions are allowed up to 200');
  assert.equal(ok(withLayers([{ shape: 'circle', x: 250, y: 10, w: 5 }])).ok, false);
  assert.equal(ok(withLayers([{ x: 10, y: 10 }])).ok, false);
  const noLayers = rainbow();
  delete noLayers.scenes[0].params.layers;
  assert.equal(ok(noLayers).ok, false);
});

test('every exported shape, motion, origin and easing is accepted', () => {
  for (const shape of LAYER_SHAPES) for (const motion of LAYER_MOTIONS) {
    const layer = { shape, x: 50, y: 50, w: 10, h: 10, motion, color: LAYER_COLORS[0] };
    if (shape === 'line') Object.assign(layer, { x2: 70, y2: 60 });
    assert.deepEqual(ok(withLayers([layer])).errors, [], `${shape}/${motion}`);
  }
  for (const origin of LAYER_ORIGINS) assert.equal(ok(withLayers([{ shape: 'pill', x: 50, y: 50, origin }])).ok, true, origin);
  for (const ease of KEY_EASINGS) assert.equal(ok(withLayers([{ shape: 'circle', x: 50, y: 50, keys: [{ t: 1, x: 60, ease }] }])).ok, true, ease);
});

test('a line needs both endpoints', () => {
  assert.equal(ok(withLayers([{ shape: 'line', x: 10, y: 10 }])).ok, false);
  assert.equal(ok(withLayers([{ shape: 'line', x: 10, y: 10, x2: 50, y2: 50 }])).ok, true);
});

test('parenting: ids are unique and a parent must be an earlier layer', () => {
  const dup = ok(withLayers([{ shape: 'circle', id: 'a', x: 1, y: 1 }, { shape: 'circle', id: 'a', x: 2, y: 2 }]));
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((e) => e.includes('duplicate layer id')));
  const later = ok(withLayers([{ shape: 'circle', parent: 'a', x: 1, y: 1 }, { shape: 'circle', id: 'a', x: 2, y: 2 }]));
  assert.equal(later.ok, false);
  assert.ok(later.errors.some((e) => e.includes('earlier layer')));
  const self = ok(withLayers([{ shape: 'circle', id: 'a', parent: 'a', x: 1, y: 1 }]));
  assert.equal(self.ok, false);
  assert.equal(ok(withLayers([{ shape: 'circle', id: 'a', x: 1, y: 1 }, { shape: 'pill', parent: 'a', x: 5, y: 0 }])).ok, true);
  assert.equal(ok(withLayers([{ shape: 'circle', id: 'Bad Id!', x: 1, y: 1 }])).ok, false);
});

test('keyframes: bounded list, required time, only known properties', () => {
  const key = (o = {}) => ({ t: 1, x: 60, rotate: 90, scale: 1.2, opacity: 0.5, ease: 'smooth', ...o });
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, keys: [key()] }])).ok, true);
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, keys: [] }])).ok, false);
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, keys: Array.from({ length: 33 }, (_, i) => key({ t: i * 0.5 })) }])).ok, false);
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, keys: [{ x: 5 }] }])).ok, false, 't is required');
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, keys: [key({ color: 'red' })] }])).ok, false);
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, keys: [key({ scale: 0 })] }])).ok, false);
});

test('repeat and spawner expansion is capped', () => {
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, count: 24 }])).ok, true);
  assert.equal(ok(withLayers([{ shape: 'circle', x: 10, y: 10, count: 25 }])).ok, false);
  const many = Array.from({ length: 84 }, () => ({ shape: 'circle', x: 10, y: 10, count: 24 }));
  const r = ok(withLayers(many));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes(`max ${GRAPHIC_MAX_SHAPES}`)));
  const spawn = Array.from({ length: 34 }, () => ({ shape: 'circle', x: 10, y: 10, emit: 60 }));
  assert.equal(ok(withLayers(spawn)).ok, false);
  assert.equal(ok(withLayers(spawn.slice(0, 3))).ok, true);
});

test('hits: bounded list with bounded intensities', () => {
  const layers = [{ shape: 'circle', x: 10, y: 10 }];
  assert.equal(ok(withLayers(layers, { hits: [{ at: 1, shake: 2, flash: 0.5, freeze: 0.1, zoom: 0.05 }] })).ok, true);
  assert.equal(ok(withLayers(layers, { hits: [] })).ok, false);
  assert.equal(ok(withLayers(layers, { hits: Array.from({ length: 7 }, (_, i) => ({ at: i })) })).ok, false);
  assert.equal(ok(withLayers(layers, { hits: [{ at: 1, freeze: 0.9 }] })).ok, false);
  assert.equal(ok(withLayers(layers, { hits: [{ shake: 1 }] })).ok, false, 'at is required');
  assert.equal(ok(withLayers(layers, { hits: [{ at: 1, code: 'x' }] })).ok, false);
});

test('text, style and image fields validate with their bounds', () => {
  const text = (o) => ({ shape: 'text', x: 50, y: 50, text: 'Hi', ...o });
  assert.equal(ok(withLayers([text({ weight: 900, spacing: 0.1, caps: true, maxw: 80, stroke: 'black', strokeW: 1, shadow: 4 })])).ok, true);
  for (const reveal of LAYER_REVEALS) assert.equal(ok(withLayers([text({ reveal, revealStep: 0.1 })])).ok, true, reveal);
  for (const blend of LAYER_BLENDS) assert.equal(ok(withLayers([{ shape: 'circle', x: 5, y: 5, blend }])).ok, true, blend);
  for (const fit of IMAGE_FITS) assert.equal(ok(withLayers([{ shape: 'image', x: 5, y: 5, w: 20, h: 20, fit, radius: 4 }])).ok, true, fit);
  assert.equal(ok(withLayers([text({ text: 'x'.repeat(90) })])).ok, true);
  assert.equal(ok(withLayers([text({ text: 'x'.repeat(91) })])).ok, false);
  for (const bad of [{ weight: 100 }, { weight: 450.5 }, { spacing: 5 }, { maxw: 2 }, { reveal: 'letters' }, { stroke: 'chartreuse' }, { strokeW: 50 }, { shadow: 99 }, { blend: 'dissolve' }, { fit: 'stretch' }, { radius: 90 }, { caps: 'yes' }, { fixed: 1 }]) {
    assert.equal(ok(withLayers([text(bad)])).ok, false, JSON.stringify(bad));
  }
  assert.equal(ok(withLayers([text({ fixed: true, loop: true, keys: [{ t: 1, x: 60 }] })])).ok, true);
});

test('scene camera: bounded keyframes with only known fields', () => {
  const layers = [{ shape: 'circle', x: 10, y: 10 }];
  const key = (o = {}) => ({ t: 1, x: 60, y: 40, zoom: 1.5, rotate: 5, ease: 'smooth', ...o });
  assert.equal(ok(withLayers(layers, { camera: [key()] })).ok, true);
  assert.equal(ok(withLayers(layers, { camera: [] })).ok, false);
  assert.equal(ok(withLayers(layers, { camera: Array.from({ length: 13 }, (_, i) => key({ t: i })) })).ok, false);
  assert.equal(ok(withLayers(layers, { camera: [{ x: 5 }] })).ok, false, 't is required');
  assert.equal(ok(withLayers(layers, { camera: [key({ zoom: 0.1 })] })).ok, false);
  assert.equal(ok(withLayers(layers, { camera: [key({ zoom: 9 })] })).ok, false);
  assert.equal(ok(withLayers(layers, { camera: [key({ rotate: 90 })] })).ok, false);
  assert.equal(ok(withLayers(layers, { camera: [key({ code: 'x' })] })).ok, false);
  assert.equal(ok(withLayers(layers, { camera: [key()], hits: [{ at: 1, shake: 1 }] })).ok, true);
});

test('every demo project validates, fits the byte cap and its shots are inside the ad', () => {
  for (const [name, demo] of Object.entries(GRAPHIC_DEMOS)) {
    const r = ok(demo.project);
    assert.deepEqual(r.errors, [], name);
    const total = demo.project.scenes.reduce((n, s) => n + s.duration * 1000, 0);
    assert.ok(demo.shots.length >= 3, `${name} has shots`);
    for (const ms of demo.shots) assert.ok(ms >= 0 && ms <= total, `${name} shot ${ms}`);
  }
});
