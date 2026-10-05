import test from 'node:test';
import assert from 'node:assert/strict';

const { getVenturesOverview } = await import('../lib/venturesOverview.js');

const NOW = 1000000000000;

test('lists ventures excluding the dashboard canvas', async () => {
  const result = await getVenturesOverview({
    listCanvases: async () => [
      { id: 'dashboard', name: 'dashboard', panels: {}, created_at: 1, updated_at: 1 },
      { id: 'venture-a', name: 'Venture A', panels: {}, created_at: 2, updated_at: 2 },
    ],
    readBoard: async () => ({ tasks: [] }),
    now: () => NOW,
  });
  assert.equal(result.venture_count, 1);
  assert.equal(result.ventures[0].id, 'venture-a');
});

test('counts linked tasks by canvas_id, ignoring tasks with no canvas_id or a different one', async () => {
  const result = await getVenturesOverview({
    listCanvases: async () => [{ id: 'venture-a', name: 'Venture A', panels: {}, created_at: 1, updated_at: 1 }],
    readBoard: async () => ({
      tasks: [
        { id: 't1', canvas_id: 'venture-a', status: 'building' },
        { id: 't2', canvas_id: 'venture-a', status: 'complete' },
        { id: 't3', canvas_id: 'venture-b', status: 'building' },
        { id: 't4', status: 'building' }, // no canvas_id at all — pre-existing task
      ],
    }),
    now: () => NOW,
  });
  const venture = result.ventures[0];
  assert.equal(venture.tasks.total, 2);
  assert.equal(venture.tasks.open, 1);
});

test('needs_attention counts blocked and waiting_for_justin tasks', async () => {
  const result = await getVenturesOverview({
    listCanvases: async () => [{ id: 'venture-a', name: 'Venture A', panels: {}, created_at: 1, updated_at: 1 }],
    readBoard: async () => ({
      tasks: [
        { id: 't1', canvas_id: 'venture-a', status: 'blocked' },
        { id: 't2', canvas_id: 'venture-a', status: 'waiting_for_justin' },
        { id: 't3', canvas_id: 'venture-a', status: 'building' },
      ],
    }),
    now: () => NOW,
  });
  assert.equal(result.ventures[0].tasks.needs_attention, 2);
  assert.equal(result.needs_attention_count, 2);
});

test('flags a venture as stale after a week of no activity, not before', async () => {
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const result = await getVenturesOverview({
    listCanvases: async () => [
      { id: 'stale-one', name: 'Stale', panels: {}, created_at: NOW - oneWeekMs - 1000, updated_at: NOW - oneWeekMs - 1000 },
      { id: 'fresh-one', name: 'Fresh', panels: {}, created_at: NOW - 1000, updated_at: NOW - 1000 },
    ],
    readBoard: async () => ({ tasks: [] }),
    now: () => NOW,
  });
  const stale = result.ventures.find((v) => v.id === 'stale-one');
  const fresh = result.ventures.find((v) => v.id === 'fresh-one');
  assert.equal(stale.stale, true);
  assert.equal(fresh.stale, false);
  assert.equal(result.stale_count, 1);
});

test('sorts ventures by most recent activity first', async () => {
  const result = await getVenturesOverview({
    listCanvases: async () => [
      { id: 'older', name: 'Older', panels: {}, created_at: 1, updated_at: 100 },
      { id: 'newer', name: 'Newer', panels: {}, created_at: 1, updated_at: 500 },
    ],
    readBoard: async () => ({ tasks: [] }),
    now: () => NOW,
  });
  assert.deepEqual(result.ventures.map((v) => v.id), ['newer', 'older']);
});

test('builds a real canvas.html URL for each venture', async () => {
  const result = await getVenturesOverview({
    listCanvases: async () => [{ id: 'my-venture', name: 'My Venture', panels: {}, created_at: 1, updated_at: 1 }],
    readBoard: async () => ({ tasks: [] }),
    now: () => NOW,
  });
  assert.equal(result.ventures[0].url, '/canvas.html?id=my-venture&name=My%20Venture');
});

test('panel_count reflects the number of panels on the canvas', async () => {
  const result = await getVenturesOverview({
    listCanvases: async () => [{ id: 'v', name: 'V', panels: { notes: {}, chat: {} }, created_at: 1, updated_at: 1 }],
    readBoard: async () => ({ tasks: [] }),
    now: () => NOW,
  });
  assert.equal(result.ventures[0].panel_count, 2);
});
