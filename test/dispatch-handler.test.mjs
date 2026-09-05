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

test('rejects methods other than GET and POST', async () => {
  const { default: handler } = await import('../api/dispatch.js?t=1');
  const res = mockRes();
  await handler({ method: 'DELETE' }, res);
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

// --- GET /api/dispatch — audit trail read path (task 10 audit viewer) ---

test('GET returns the audit trail with a default limit', async () => {
  const events = [{ type: 'dispatched', task_id: 't1' }, { type: 'completed', task_id: 't1' }];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    assert.equal(command[0], 'LRANGE');
    assert.equal(command[2], '0');
    assert.equal(command[3], '99'); // default limit 100 -> LRANGE end index 99
    return { ok: true, async json() { return { result: events.map((e) => JSON.stringify(e)) }; } };
  };
  try {
    const { default: handler } = await import('../api/dispatch.js?t=7');
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.events, events);
    assert.equal(res.body.limit, 100);
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET respects a valid ?limit= query param', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    assert.equal(command[3], '4'); // limit=5 -> end index 4
    return { ok: true, async json() { return { result: [] }; } };
  };
  try {
    const { default: handler } = await import('../api/dispatch.js?t=8');
    const res = mockRes();
    await handler({ method: 'GET', query: { limit: '5' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.limit, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET clamps an out-of-range ?limit= to the max instead of trusting client input', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    assert.equal(command[3], '499'); // clamped to MAX_AUDIT_LIMIT (500) -> end index 499
    return { ok: true, async json() { return { result: [] }; } };
  };
  try {
    const { default: handler } = await import('../api/dispatch.js?t=9');
    const res = mockRes();
    await handler({ method: 'GET', query: { limit: '999999' } }, res);
    assert.equal(res.body.limit, 500);
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET falls back to the default limit for an invalid (non-numeric or negative) ?limit=', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    assert.equal(command[3], '99');
    return { ok: true, async json() { return { result: [] }; } };
  };
  try {
    const { default: handler } = await import('../api/dispatch.js?t=10');
    const res = mockRes();
    await handler({ method: 'GET', query: { limit: '-5' } }, res);
    assert.equal(res.body.limit, 100);
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET skips malformed entries in the audit log rather than crashing', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return { result: ['{"type":"dispatched"}', 'not-json{{{', '{"type":"completed"}'] }; } });
  try {
    const { default: handler } = await import('../api/dispatch.js?t=11');
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.events.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
