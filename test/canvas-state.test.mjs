import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { getCanvasState, setBackdrop, setPanelLayout, deletePanelLayout } = await import('../lib/canvasState.js');

function mockRedis({ stored }) {
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'GET') return { ok: true, async json() { return { result: stored.value }; } };
    if (command[0] === 'SET') { stored.value = command[2]; return { ok: true, async json() { return { result: 'OK' }; } }; }
    throw new Error(`unexpected command ${command[0]}`);
  };
}

test('getCanvasState returns an empty default when nothing is stored', async () => {
  mockRedis({ stored: { value: null } });
  const state = await getCanvasState();
  assert.deepEqual(state, { backdrop_url: null, panels: {}, updated_at: null });
});

test('setBackdrop stores the url and preserves existing panels', async () => {
  const stored = { value: JSON.stringify({ backdrop_url: null, panels: { a: { x: 1, y: 2, w: 300, h: 200, z: 0 } } }) };
  mockRedis({ stored });
  const state = await setBackdrop({ url: 'https://example.com/bg.png' });
  assert.equal(state.backdrop_url, 'https://example.com/bg.png');
  assert.deepEqual(state.panels.a, { x: 1, y: 2, w: 300, h: 200, z: 0 });
});

test('setBackdrop with no url clears it', async () => {
  const stored = { value: JSON.stringify({ backdrop_url: 'old.png', panels: {} }) };
  mockRedis({ stored });
  const state = await setBackdrop({ url: null });
  assert.equal(state.backdrop_url, null);
});

test('setPanelLayout creates a new panel with given values', async () => {
  mockRedis({ stored: { value: null } });
  const state = await setPanelLayout({ id: 'chat', x: 10, y: 20, w: 380, h: 500, z: 3 });
  assert.deepEqual(state.panels.chat, { x: 10, y: 20, w: 380, h: 500, z: 3 });
});

test('setPanelLayout falls back to the existing value for an invalid field instead of poisoning the rest', async () => {
  const stored = { value: JSON.stringify({ backdrop_url: null, panels: { chat: { x: 10, y: 20, w: 380, h: 500, z: 3 } } }) };
  mockRedis({ stored });
  const state = await setPanelLayout({ id: 'chat', x: 50, w: -10 });
  assert.equal(state.panels.chat.x, 50);
  assert.equal(state.panels.chat.w, 380); // invalid negative width ignored, old value kept
  assert.equal(state.panels.chat.y, 20); // untouched field preserved
});

test('setPanelLayout throws without an id', async () => {
  await assert.rejects(() => setPanelLayout({ x: 1 }), /id is required/);
});

test('deletePanelLayout removes a panel by id', async () => {
  const stored = { value: JSON.stringify({ backdrop_url: null, panels: { chat: { x: 1, y: 1, w: 1, h: 1, z: 0 }, board: { x: 2, y: 2, w: 2, h: 2, z: 0 } } }) };
  mockRedis({ stored });
  const state = await deletePanelLayout({ id: 'chat' });
  assert.equal(state.panels.chat, undefined);
  assert.ok(state.panels.board);
});
