import test from 'node:test';
import assert from 'node:assert/strict';
import { imageIdsOf } from '../lib/adImages.js';
import { pickImages, projectImageIds } from '../lib/adExport.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('images inside graphic layers are collected and exported like scene images', () => {
  const project = { specVersion: 2, name: 'g', mood: 'bold', palette: 'ocean-blue', platform: { format: 'portrait', lengthSec: 15 }, scenes: [
    { id: 'g1', type: 'graphic', duration: 3, background: 'gradient', params: { layers: [{ shape: 'image', x: 50, y: 50, w: 40, imageId: 'img-1111111111' }, { shape: 'circle', x: 10, y: 10, w: 5, color: 'red' }] } },
    { id: 'g2', type: 'graphic', duration: 3, background: 'gradient', params: { layers: [{ shape: 'image', x: 50, y: 50, w: 40, imageId: 'img-1111111111' }, { shape: 'image', x: 20, y: 20, w: 10, imageId: 'img-2222222222' }] } },
    { id: 'end', type: 'end_card', duration: 2.6, params: { cta: 'Go' } }] };
  assert.deepEqual(imageIdsOf(project), ['img-1111111111', 'img-2222222222']);
  assert.deepEqual(projectImageIds(project), ['img-1111111111', 'img-2222222222']);
  assert.throws(() => pickImages(project, { 'img-1111111111': { src: PNG } }), /Missing library images: img-2222222222/);
  const out = pickImages(project, { 'img-1111111111': { src: PNG }, 'img-2222222222': { src: PNG, source: 'ai_generated' } });
  assert.deepEqual(Object.keys(out), ['img-1111111111', 'img-2222222222']);
});

test('scene-level and layer-level ids are both found, in scene order, once each', () => {
  const p = { scenes: [{ params: { imageId: 'img-aaaaaaaaaa', layers: [{ imageId: 'img-bbbbbbbbbb' }] } }, { params: { layers: [{ imageId: 'img-aaaaaaaaaa' }] } }, { params: {} }, null] };
  assert.deepEqual(imageIdsOf(p), ['img-aaaaaaaaaa', 'img-bbbbbbbbbb']);
  assert.deepEqual(imageIdsOf(null), []);
});
