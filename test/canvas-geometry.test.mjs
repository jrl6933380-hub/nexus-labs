import test from 'node:test';
import assert from 'node:assert/strict';

const { clampPosition, clampSize, defaultMobileRect, resizeFromHandle, finalizeResize, foldTiles, unfoldTile, resolveVisibleItems } = await import('../public/canvas-geometry.js');

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

test('defaultMobileRect exposes each panel header in a vertical cascade', () => {
  const phone = { width: 390, height: 844 };
  assert.deepEqual(defaultMobileRect({ w: 380, h: 360 }, phone, 0), { x: 12, y: 72, w: 366, h: 360 });
  assert.deepEqual(defaultMobileRect({ w: 300, h: 280 }, phone, 1), { x: 12, y: 128, w: 366, h: 280 });
  assert.deepEqual(defaultMobileRect({ w: 260, h: 700 }, phone, 2), { x: 12, y: 184, w: 366, h: 607 });
});

test('defaultMobileRect keeps later headers reachable on a short viewport', () => {
  const phone = { width: 360, height: 480 };
  assert.equal(defaultMobileRect({ h: 300 }, phone, 20).y, 312);
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

test('foldTiles creates a new folder from two plain tiles', () => {
  const folders = foldTiles({}, 'venture-a', 'venture-b');
  const keys = Object.keys(folders);
  assert.equal(keys.length, 1);
  assert.deepEqual(folders[keys[0]].children.sort(), ['venture-a', 'venture-b']);
});

test('foldTiles adds a plain tile into an existing target folder', () => {
  const start = { 'folder-x': { title: 'Folder', children: ['a', 'b'] } };
  const next = foldTiles(start, 'c', 'folder-x');
  assert.equal(Object.keys(next).length, 1);
  assert.deepEqual(next['folder-x'].children.sort(), ['a', 'b', 'c']);
});

test('foldTiles absorbs a plain tile into the dragged folder when only the dragged item is a folder', () => {
  const start = { 'folder-x': { title: 'Folder', children: ['a', 'b'] } };
  const next = foldTiles(start, 'folder-x', 'c');
  assert.equal(Object.keys(next).length, 1);
  assert.deepEqual(next['folder-x'].children.sort(), ['a', 'b', 'c']);
});

test('foldTiles treats a self-drop as a no-op', () => {
  const start = { 'folder-x': { title: 'Folder', children: ['a', 'b'] } };
  assert.deepEqual(foldTiles(start, 'folder-x', 'folder-x'), start);
});

test('foldTiles treats a missing dragged or target id as a no-op', () => {
  assert.deepEqual(foldTiles({}, null, 'x'), {});
  assert.deepEqual(foldTiles({}, 'x', undefined), {});
});

test('unfoldTile leaves a real folder behind when more than one tile remains', () => {
  const start = { 'folder-x': { title: 'Folder', children: ['a', 'b', 'c'] } };
  const next = unfoldTile(start, 'b');
  assert.deepEqual(next['folder-x'].children.sort(), ['a', 'c']);
});

test('unfoldTile dissolves a folder down to its last single tile', () => {
  const start = { 'folder-x': { title: 'Folder', children: ['a', 'b'] } };
  assert.deepEqual(unfoldTile(start, 'b'), {});
});

test('unfoldTile is a no-op for a tile that is not in any folder', () => {
  const start = { 'folder-x': { title: 'Folder', children: ['a', 'b'] } };
  assert.deepEqual(unfoldTile(start, 'zzz'), start);
});

test('resolveVisibleItems collapses a folder to one entry at its first member\'s position', () => {
  const itemIds = ['room-a', 'venture-a', 'venture-b', 'room-c'];
  const folders = { 'folder-1': { title: 'My Folder', children: ['venture-a', 'venture-b'] } };
  const items = resolveVisibleItems(itemIds, folders);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.id), ['room-a', 'folder-1', 'room-c']);
  assert.equal(items[1].isFolder, true);
});

test('resolveVisibleItems filters out a folder member that no longer exists', () => {
  const itemIds = ['venture-a'];
  const folders = { 'folder-1': { title: 'My Folder', children: ['venture-a', 'venture-b'] } };
  assert.deepEqual(resolveVisibleItems(itemIds, folders), [{ id: 'venture-a', isFolder: false }]);
});

test('resolveVisibleItems passes tiles through unchanged when there are no folders', () => {
  assert.deepEqual(resolveVisibleItems(['a', 'b'], {}), [{ id: 'a', isFolder: false }, { id: 'b', isFolder: false }]);
});
