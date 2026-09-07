import test from 'node:test';
import assert from 'node:assert/strict';

const { clampPosition, clampSize, resizeFromHandle, finalizeResize } = await import('../public/canvas-geometry.js');

const viewport = { width: 1000, height: 800 };

test('clampPosition keeps a panel fully on screen when dragged past the right/bottom edge', () => {
  const result = clampPosition({ x: 2000, y: 2000, w: 300, h: 200 }, viewport);
  assert.deepEqual(result, { x: 692, y: 592 }); // 1000-300-8, 800-200-8
});

test('clampPosition keeps a panel on screen when dragged past the left/top edge', () => {
  const result = clampPosition({ x: -500, y: -500, w: 300, h: 200 }, viewport);
  assert.deepEqual(result, { x: 8, y: 8 });
});

test('clampPosition leaves an in-bounds panel untouched', () => {
  const result = clampPosition({ x: 100, y: 150, w: 300, h: 200 }, viewport);
  assert.deepEqual(result, { x: 100, y: 150 });
});

test('clampSize enforces the minimum panel size', () => {
  const result = clampSize({ w: 10, h: 5 }, viewport);
  assert.deepEqual(result, { w: 200, h: 120 });
});

test('clampSize never exceeds the viewport', () => {
  const result = clampSize({ w: 5000, h: 5000 }, viewport);
  assert.deepEqual(result, { w: 984, h: 784 });
});

test('resizeFromHandle "se" grows width and height, keeps x/y fixed', () => {
  const result = resizeFromHandle({ startRect: { x: 50, y: 60, w: 300, h: 200 }, dx: 40, dy: 20, handle: 'se' });
  assert.deepEqual(result, { x: 50, y: 60, w: 340, h: 220 });
});

test('resizeFromHandle "nw" shrinks from the top-left, moving x/y so the bottom-right corner stays put', () => {
  const result = resizeFromHandle({ startRect: { x: 50, y: 60, w: 300, h: 200 }, dx: 30, dy: 10, handle: 'nw' });
  assert.deepEqual(result, { x: 80, y: 70, w: 270, h: 190 });
});

test('resizeFromHandle "e" only changes width', () => {
  const result = resizeFromHandle({ startRect: { x: 50, y: 60, w: 300, h: 200 }, dx: -50, dy: 999, handle: 'e' });
  assert.deepEqual(result, { x: 50, y: 60, w: 250, h: 200 });
});

test('finalizeResize keeps the east edge fixed when shrinking from the west past the minimum', () => {
  // Dragging the west edge far to the right would shrink width below
  // the minimum; the east edge (x + original w) must stay put rather
  // than the panel silently sliding.
  const startRect = { x: 100, y: 100, w: 300, h: 200 };
  const result = finalizeResize({ startRect, dx: 250, dy: 0, handle: 'w' }, viewport);
  const eastEdge = result.x + result.w;
  assert.equal(eastEdge, startRect.x + startRect.w);
  assert.equal(result.w, 200); // clamped to MIN_PANEL_W
});

test('finalizeResize clamps a normal "se" resize without moving x/y', () => {
  const startRect = { x: 100, y: 100, w: 300, h: 200 };
  const result = finalizeResize({ startRect, dx: 40, dy: 20, handle: 'se' }, viewport);
  assert.deepEqual(result, { x: 100, y: 100, w: 340, h: 220 });
});
