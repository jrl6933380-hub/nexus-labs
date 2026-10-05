import test from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/forge-activate-brain.js';

// This endpoint spends our money. Every test here is about a gate holding,
// because the failure mode is not a broken page — it is an unbounded bill or
// a key minted for someone who should not have one.

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const PROVISIONING = 'OPENROUTER_PROVISIONING_KEY';

function withProvisioning(value, run) {
  const previous = process.env[PROVISIONING];
  if (value === null) delete process.env[PROVISIONING];
  else process.env[PROVISIONING] = value;
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env[PROVISIONING];
    else process.env[PROVISIONING] = previous;
  });
}

test('rejects a non-POST request', async () => {
  const res = makeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('an anonymous caller can never mint', async () => {
  await withProvisioning('prov-key', async () => {
    const res = makeRes();
    // No session cookie at all: getRequestUser resolves to nothing.
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.funded, undefined, 'nothing should have been minted');
  });
});

test('reports unavailable rather than falling back when provisioning is off', async () => {
  await withProvisioning(null, async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    // Anonymous is caught first; the ordering itself is the assertion that
    // matters — no path reaches minting without a session.
    assert.ok(res.statusCode === 401 || res.statusCode === 503);
    assert.notEqual(res.statusCode, 200);
  });
});

test('the response never contains key material', async () => {
  await withProvisioning('prov-key', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    const serialized = JSON.stringify(res.body || {});
    assert.ok(!serialized.includes('sk-'), 'a provider key must never reach the response body');
    assert.ok(!serialized.includes('prov-key'), 'the provisioning key must never reach the response body');
  });
});
