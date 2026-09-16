import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://project-ledger-test.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const hashes = new Map();
global.fetch = async (_url, options) => {
  const [command, key, field, value] = JSON.parse(options.body);
  const hash = hashes.get(key) || new Map();
  hashes.set(key, hash);
  let result;
  if (command === 'HINCRBY') {
    result = (Number(hash.get(field)) || 0) + Number(value);
    hash.set(field, String(result));
  } else if (command === 'HGET') {
    result = hash.has(field) ? hash.get(field) : null;
  } else if (command === 'HGETALL') {
    result = [];
    for (const [f, v] of hash) result.push(f, v);
  } else {
    throw new Error(`Unexpected command ${command}`);
  }
  return { ok: true, json: async () => ({ result }) };
};

const { recordProjectSpend, getProjectSpend, listProjectSpend } = await import('../lib/roomProjectLedger.js');

test('credits accumulate per project, independently per account', async () => {
  await recordProjectSpend({ userId: 'alice', projectId: 'p1', credits: 15 });
  await recordProjectSpend({ userId: 'alice', projectId: 'p1', credits: 2 });
  await recordProjectSpend({ userId: 'alice', projectId: 'p2', credits: 15 });
  await recordProjectSpend({ userId: 'bob', projectId: 'p1', credits: 99 });

  assert.equal(await getProjectSpend({ userId: 'alice', projectId: 'p1' }), 17);
  assert.equal(await getProjectSpend({ userId: 'alice', projectId: 'p2' }), 15);
  assert.equal(await getProjectSpend({ userId: 'bob', projectId: 'p1' }), 99, "one account's spend must never leak into another");
});

test('a project with no history reports zero, not an error', async () => {
  assert.equal(await getProjectSpend({ userId: 'alice', projectId: 'never-built' }), 0);
  assert.equal(await getProjectSpend({ userId: 'nobody', projectId: 'p1' }), 0);
});

test('nothing is recorded for a zero or failed charge', async () => {
  // settleBuild returns charged: 0 for a failed build — the reservation is
  // released and the customer is not billed. The ledger must agree, or an
  // export quote would charge for work that never happened.
  assert.equal(await recordProjectSpend({ userId: 'alice', projectId: 'p3', credits: 0 }), null);
  assert.equal(await recordProjectSpend({ userId: 'alice', projectId: 'p3', credits: -5 }), null);
  assert.equal(await recordProjectSpend({ userId: 'alice', projectId: 'p3' }), null);
  assert.equal(await getProjectSpend({ userId: 'alice', projectId: 'p3' }), 0);
});

test('missing ids are ignored rather than writing a junk row', async () => {
  assert.equal(await recordProjectSpend({ projectId: 'p1', credits: 5 }), null);
  assert.equal(await recordProjectSpend({ userId: 'alice', credits: 5 }), null);
  assert.equal(await recordProjectSpend({}), null);
});

test('listProjectSpend returns every project for an account, biggest spend first', async () => {
  const rows = await listProjectSpend('alice');
  assert.ok(rows.length >= 2);
  assert.deepEqual(rows[0], { projectId: 'p1', credits: 17 });
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].credits >= r.credits), 'must be sorted descending');
  assert.ok(!rows.some((r) => r.projectId === 'p3'), 'a project with no charged work should not appear');
});

test('listProjectSpend is empty for an unknown account', async () => {
  assert.deepEqual(await listProjectSpend('stranger'), []);
  assert.deepEqual(await listProjectSpend(), []);
});

test('the ledger is additive and never decremented', async () => {
  // It records work done, not a balance. It must survive plan changes and
  // period rollovers, so there is deliberately no spend-down path.
  const before = await getProjectSpend({ userId: 'alice', projectId: 'p1' });
  await recordProjectSpend({ userId: 'alice', projectId: 'p1', credits: 1 });
  assert.equal(await getProjectSpend({ userId: 'alice', projectId: 'p1' }), before + 1);
});
