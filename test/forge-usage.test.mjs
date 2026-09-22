import test from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/forge-usage.js';

// The contract under test: this endpoint reports a PROPORTION and never the
// underlying credit numbers. Those are tuning values — publishing them invites
// customers to optimise against a scale we expect to change, and turns any
// future rebalance into a visible price rise.

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('rejects a non-GET request', async () => {
  const res = makeRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
});

test('an anonymous caller gets 401, not a usage figure', async () => {
  const res = makeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.percentRemaining, undefined);
});

test('the response never carries raw credit fields', async () => {
  const res = makeRes();
  await handler({ method: 'GET', headers: {} }, res);
  const body = res.body || {};
  for (const leaked of ['limit', 'consumed', 'reserved', 'remaining', 'credits', 'unit']) {
    assert.equal(body[leaked], undefined, `${leaked} must not be exposed to the client`);
  }
});
