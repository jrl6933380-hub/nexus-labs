import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickFreeModel,
  recordFreeModelStall,
  recordFreeModelMissing,
  FREE_MODEL_ALLOWLIST,
  FREE_ROUTER_FALLBACK,
} from '../lib/forge/freeModelPool.js';

// These run without KV_REST_API_URL/KV_REST_API_TOKEN, the normal CI case:
// redisCommand() short-circuits to null and cooldowns read as empty. That is
// itself under test — the pool must work, and never throw, with no Redis.

test('pickFreeModel only returns models from the allowlist', async () => {
  for (let i = 0; i < 20; i++) {
    const model = await pickFreeModel();
    assert.ok(FREE_MODEL_ALLOWLIST.includes(model), `${model} should be in the allowlist`);
  }
});

test('pickFreeModel never returns an excluded model', async () => {
  const excluded = FREE_MODEL_ALLOWLIST[0];
  for (let i = 0; i < 20; i++) {
    const model = await pickFreeModel({ excluding: [excluded] });
    assert.notEqual(model, excluded);
  }
});

test('pickFreeModel falls back to the free router when every model is excluded', async () => {
  const model = await pickFreeModel({ excluding: [...FREE_MODEL_ALLOWLIST] });
  assert.equal(model, FREE_ROUTER_FALLBACK,
    'a fully exhausted allowlist must degrade to the always-present router, not fail');
});

test('cooldown recorders never throw without Redis configured', async () => {
  await assert.doesNotReject(() => recordFreeModelStall(FREE_MODEL_ALLOWLIST[0]));
  await assert.doesNotReject(() => recordFreeModelMissing(FREE_MODEL_ALLOWLIST[0]));
});

test('pickFreeModel ignores falsy entries in excluding', async () => {
  const model = await pickFreeModel({ excluding: [null, undefined, ''] });
  assert.ok(FREE_MODEL_ALLOWLIST.includes(model));
});

test('every allowlisted slug is shaped like a free OpenRouter model id', () => {
  // Cheap structural guard. The real check is the live-catalog test below;
  // this one catches an obviously malformed entry without needing network.
  for (const id of FREE_MODEL_ALLOWLIST) {
    assert.match(id, /^[a-z0-9-]+\/[a-z0-9.\-]+:free$/,
      `${id} does not look like a free OpenRouter model slug`);
  }
});

// The regression test for the bug that broke the free tier: the original
// allowlist was written from memory and every slug 404'd. Slugs must come
// from OpenRouter's live catalog, and this is what proves they still do.
// Skipped automatically when the network isn't reachable so it can't turn
// into a flaky CI failure — it's a canary, not a gate.
test('allowlisted slugs exist in OpenRouter\'s live catalog and are free', async (t) => {
  let catalog;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return t.skip(`catalog returned ${response.status}`);
    catalog = await response.json();
  } catch (error) {
    return t.skip(`catalog unreachable: ${error.message}`);
  }

  const free = new Map();
  for (const model of catalog?.data || []) {
    const { prompt, completion } = model.pricing || {};
    if (Number(prompt) === 0 && Number(completion) === 0) free.set(model.id, model);
  }
  assert.ok(free.size > 0, 'expected the catalog to list at least one free model');

  const missing = FREE_MODEL_ALLOWLIST.filter((id) => !free.has(id));
  assert.deepEqual(missing, [],
    `these slugs are not free/available on OpenRouter any more — refresh FREE_MODEL_ALLOWLIST from the live catalog: ${missing.join(', ')}`);
});
