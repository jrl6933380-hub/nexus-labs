import assert from 'node:assert/strict';
import test from 'node:test';

import { createPinnedVisualService, PINNED_VISUAL_LIMITS } from '../lib/pinnedVisuals.js';

function memoryStore() {
  const records = new Map();
  return {
    records,
    async read(roomId) { return records.get(roomId) || null; },
    async write(record) { records.set(record.room_id, structuredClone(record)); },
  };
}

test('render persists the active room visual and caps history at five', async () => {
  const store = memoryStore();
  const service = createPinnedVisualService(store);

  for (let index = 1; index <= 7; index += 1) {
    await service.render({ room_id: 'conference-room', widget_code: `<h1>Visual ${index}</h1>`, source: 'test' });
  }

  const visual = await service.get('conference-room');
  assert.equal(visual.widget_code, '<h1>Visual 7</h1>');
  assert.equal(visual.history.length, PINNED_VISUAL_LIMITS.maxHistory);
  assert.equal(visual.history[0].widget_code, '<h1>Visual 7</h1>');
  assert.equal(visual.history.at(-1).widget_code, '<h1>Visual 3</h1>');
});

test('locked rooms save new visuals to history without replacing the active visual', async () => {
  const service = createPinnedVisualService(memoryStore());
  await service.render({ room_id: 'command-center', widget_code: '<p>Keep me</p>' });
  await service.setLocked({ room_id: 'command-center', locked: true });

  const result = await service.render({ room_id: 'command-center', widget_code: '<p>Later</p>' });

  assert.equal(result.rendered, false);
  assert.equal(result.locked, true);
  assert.equal(result.widget_code, '<p>Keep me</p>');
  assert.equal(result.history[0].widget_code, '<p>Later</p>');
});

test('a history item can be restored while the panel remains locked', async () => {
  const service = createPinnedVisualService(memoryStore());
  const first = await service.render({ room_id: 'room-builder', widget_code: '<p>First</p>' });
  await service.render({ room_id: 'room-builder', widget_code: '<p>Second</p>' });
  await service.setLocked({ room_id: 'room-builder', locked: true });

  const restored = await service.restore({ room_id: 'room-builder', history_id: first.history[0].id });

  assert.equal(restored.widget_code, '<p>First</p>');
  assert.equal(restored.locked, true);
  assert.equal(restored.history[0].id, first.history[0].id);
});

test('invalid rooms and empty or oversized widgets are rejected', async () => {
  const service = createPinnedVisualService(memoryStore());
  await assert.rejects(() => service.get('../secrets'), /room_id/u);
  await assert.rejects(() => service.render({ room_id: 'memory-archive', widget_code: '' }), /widget_code is required/u);
  await assert.rejects(
    () => service.render({ room_id: 'memory-archive', widget_code: 'x'.repeat(PINNED_VISUAL_LIMITS.maxWidgetChars + 1) }),
    /exceeds/u,
  );
});
