import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('rejects non-POST requests', async () => {
  const { default: handler } = await import('../api/dispatch.js?t=1');
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('requires an action field', async () => {
  const { default: handler } = await import('../api/dispatch.js?t=2');
  const res = mockRes();
  await handler({ method: 'POST', body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /action is required/);
});

test('requires task_id for actions other than recover_expired', async () => {
  const { default: handler } = await import('../api/dispatch.js?t=3');
  const res = mockRes();
  await handler({ method: 'POST', body: { action: 'dispatch' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /task_id is required/);
});

test('returns 404 for an unknown task_id', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return { result: [] }; } });
  try {
    const { default: handler } = await import('../api/dispatch.js?t=4');
    const res = mockRes();
    await handler({ method: 'POST', body: { action: 'dispatch', task_id: 'does-not-exist' } }, res);
    assert.equal(res.statusCode, 404);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects an unknown action once a real task_id is found', async () => {
  const originalFetch = global.fetch;
  const boardTask = { id: 'task-1', title: 'Do a thing', status: 'idle', owner: null, created_at: Date.now() };
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'HGETALL') return { ok: true, async json() { return { result: ['task-1', JSON.stringify(boardTask)] }; } };
    return { ok: true, async json() { return { result: null }; } };
  };
  try {
    const { default: handler } = await import('../api/dispatch.js?t=5');
    const res = mockRes();
    await handler({ method: 'POST', body: { action: 'nonexistent_action', task_id: 'task-1' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Unknown action/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('does not crash the process on an internal error — responds 500 instead', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('redis unreachable'); };
  try {
    const { default: handler } = await import('../api/dispatch.js?t=6');
    const res = mockRes();
    await handler({ method: 'POST', body: { action: 'recover_expired' } }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /redis unreachable/);
  } finally {
    global.fetch = originalFetch;
  }
});
