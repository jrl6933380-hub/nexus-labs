import test from 'node:test';
import assert from 'node:assert/strict';

import { pickFreeModel, recordFreeModelStall, FREE_MODEL_ALLOWLIST } from '../lib/forge/freeModelPool.js';

// These tests run without KV_REST_API_URL/KV_REST_API_TOKEN set, which is
// the normal case in CI — redisCommand() short-circuits to null and the
// cooldown is treated as empty. That's the behavior under test here: the
// pool must still work correctly (and never throw) with no Redis available.

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

test('pickFreeModel falls back to the full allowlist rather than throwing when every model is excluded', async () => {
  const model = await pickFreeModel({ excluding: [...FREE_MODEL_ALLOWLIST] });
  assert.ok(FREE_MODEL_ALLOWLIST.includes(model));
});

test('recordFreeModelStall is a no-op (never throws) without Redis configured', async () => {
  await assert.doesNotReject(() => recordFreeModelStall(FREE_MODEL_ALLOWLIST[0]));
});

test('pickFreeModel ignores falsy entries in excluding', async () => {
  const model = await pickFreeModel({ excluding: [null, undefined, ''] });
  assert.ok(FREE_MODEL_ALLOWLIST.includes(model));
});
