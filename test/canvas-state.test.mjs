import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const {
  getCanvasState,
  setBackdrop,
  setPanelLayout,
  deletePanelLayout,
  createCanvas,
  deleteCanvas,
  listCanvases,
  DEFAULT_CANVAS_ID,
} = await import('../lib/canvasState.js');

function mockRedis({ store }) {
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'HGET') return { ok: true, async json() { return { result: store[command[2]] || null }; } };
    if (command[0] === 'HSET') { store[command[2]] = command[3]; return { ok: true, async json() { return { result: 1 }; } }; }
    if (command[0] === 'HDEL') { delete store[command[2]]; return { ok: true, async json() { return { result: 1 }; } }; }
    if (command[0] === 'HGETALL') {
      const flat = [];
      for (const [k, v] of Object.entries(store)) { flat.push(k, v); }
      return { ok: true, async json() { return { result: flat }; } };
    }
    throw new Error(`unexpected command ${command[0]}`);
  };
}

test('getCanvasState with no id defaults to the dashboard canvas', async () => {
  mockRedis({ store: {} });
  const state = await getCanvasState();
  assert.equal(state.id, DEFAULT_CANVAS_ID);
  assert.deepEqual(state.panels, {});
});

test('setBackdrop and setPanelLayout on the same canvas_id operate on the same instance', async () => {
  mockRedis({ store: {} });
  await setBackdrop({ canvas_id: 'venture-x', url: 'https://example.com/bg.png' });
  const state = await setPanelLayout({ canvas_id: 'venture-x', id: 'notes', x: 10, y: 20, w: 300, h: 200 });
  assert.equal(state.id, 'venture-x');
  assert.equal(state.backdrop_url, 'https://example.com/bg.png');
  assert.deepEqual(state.panels.notes, { x: 10, y: 20, w: 300, h: 200, z: 0 });
});

test('two different canvas ids are fully independent', async () => {
  mockRedis({ store: {} });
  await setBackdrop({ canvas_id: 'canvas-a', url: 'a.png' });
  await setBackdrop({ canvas_id: 'canvas-b', url: 'b.png' });
  const a = await getCanvasState('canvas-a');
  const b = await getCanvasState('canvas-b');
  assert.equal(a.backdrop_url, 'a.png');
  assert.equal(b.backdrop_url, 'b.png');
});

test('setPanelLayout falls back to the existing value for an invalid field instead of poisoning the rest', async () => {
  mockRedis({ store: {} });
  await setPanelLayout({ canvas_id: 'canvas-a', id: 'chat', x: 10, y: 20, w: 380, h: 500, z: 3 });
  const state = await setPanelLayout({ canvas_id: 'canvas-a', id: 'chat', x: 50, w: -10 });
  assert.equal(state.panels.chat.x, 50);
  assert.equal(state.panels.chat.w, 380); // invalid negative width ignored, old value kept
  assert.equal(state.panels.chat.y, 20); // untouched field preserved
});

test('setPanelLayout throws without an id', async () => {
  await assert.rejects(() => setPanelLayout({ x: 1 }), /id is required/);
});

test('createCanvas makes a new empty canvas with the given name', async () => {
  mockRedis({ store: {} });
  const canvas = await createCanvas({ id: 'venture-y', name: 'My New Venture' });
  assert.equal(canvas.id, 'venture-y');
  assert.equal(canvas.name, 'My New Venture');
  assert.deepEqual(canvas.panels, {});
  assert.equal(canvas.backdrop_url, null);
});

test('createCanvas is idempotent — calling it again does not reset an existing canvas', async () => {
  mockRedis({ store: {} });
  await createCanvas({ id: 'venture-z', name: 'Venture Z' });
  await setBackdrop({ canvas_id: 'venture-z', url: 'custom.png' });
  const again = await createCanvas({ id: 'venture-z', name: 'Venture Z' });
  assert.equal(again.backdrop_url, 'custom.png'); // not reset back to null
});

test('createCanvas throws without an id', async () => {
  await assert.rejects(() => createCanvas({ name: 'No id' }), /id is required/);
});

test('deleteCanvas removes a non-default canvas', async () => {
  mockRedis({ store: {} });
  await createCanvas({ id: 'venture-temp' });
  const result = await deleteCanvas({ id: 'venture-temp' });
  assert.deepEqual(result, { id: 'venture-temp', deleted: true });
});

test('deleteCanvas refuses to delete the dashboard canvas', async () => {
  mockRedis({ store: {} });
  await assert.rejects(() => deleteCanvas({ id: DEFAULT_CANVAS_ID }), /cannot be deleted/);
});

test('listCanvases returns every created canvas', async () => {
  mockRedis({ store: {} });
  await createCanvas({ id: 'alpha' });
  await createCanvas({ id: 'beta' });
  const list = await listCanvases();
  const ids = list.map((c) => c.id).sort();
  assert.deepEqual(ids, ['alpha', 'beta']);
});

test('deletePanelLayout only removes the panel from its own canvas', async () => {
  mockRedis({ store: {} });
  await setPanelLayout({ canvas_id: 'canvas-a', id: 'notes', x: 1, y: 1, w: 100, h: 100 });
  await setPanelLayout({ canvas_id: 'canvas-b', id: 'notes', x: 2, y: 2, w: 100, h: 100 });
  await deletePanelLayout({ canvas_id: 'canvas-a', id: 'notes' });
  const a = await getCanvasState('canvas-a');
  const b = await getCanvasState('canvas-b');
  assert.equal(a.panels.notes, undefined);
  assert.ok(b.panels.notes);
});
