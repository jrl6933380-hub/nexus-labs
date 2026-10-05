import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveBuildFunding, fundedMeterMessage, FUNDED_DENIED } from '../lib/forge/fundedAccess.js';

// The question under test throughout: may this request spend OUR money?
// Getting this wrong in the permissive direction means an unverified,
// scriptable account draining the platform budget — so the default on
// every uncertain path must be "no".

const PLATFORM_KEY = 'FORGE_PLATFORM_OPENROUTER_KEY';

function withPlatformKey(value, run) {
  const previous = process.env[PLATFORM_KEY];
  if (value === null) delete process.env[PLATFORM_KEY];
  else process.env[PLATFORM_KEY] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[PLATFORM_KEY];
    else process.env[PLATFORM_KEY] = previous;
  }
}

const hasBrain = async () => true;
const noBrain = async () => false;

test('a connected Brain wins even when funding is switched off', async () => {
  await withPlatformKey(null, async () => {
    const result = await resolveBuildFunding('someone', { checkOwnBrain: hasBrain });
    assert.equal(result.mode, 'byo', 'BYOK costs us nothing and must never be gated by our budget');
  });
});

test('a connected Brain is not blocked by an unverified email', async () => {
  await withPlatformKey('sk-test', async () => {
    // isEmailVerified is never consulted on this path: the BYOK check
    // short-circuits first. If that ordering regresses, this account
    // (which has no verified email in any store) would be denied.
    const result = await resolveBuildFunding('unverified-user', { checkOwnBrain: hasBrain });
    assert.equal(result.mode, 'byo');
  });
});

test('with no platform key, the funded route reports unavailable', async () => {
  await withPlatformKey(null, async () => {
    const result = await resolveBuildFunding('someone', { checkOwnBrain: noBrain });
    assert.equal(result.mode, 'denied');
    assert.equal(result.reason, FUNDED_DENIED.NOT_CONFIGURED,
      '"not turned on yet" must never silently become "billed to some other key"');
  });
});

test('an anonymous request is never funded', async () => {
  await withPlatformKey('sk-test', async () => {
    const result = await resolveBuildFunding(null, { checkOwnBrain: noBrain });
    assert.equal(result.mode, 'denied');
  });
});

test('a brain-check failure denies rather than funding', async () => {
  await withPlatformKey(null, async () => {
    const result = await resolveBuildFunding('someone', {
      checkOwnBrain: async () => { throw new Error('KV down'); },
    });
    // The throw is swallowed into "no brain", which then hits the
    // not-configured gate. The point is that an infrastructure failure
    // never resolves to 'funded'.
    assert.notEqual(result.mode, 'funded');
  });
});

test('meter rejections map to non-blaming, actionable copy', () => {
  const daily = fundedMeterMessage('daily_budget_exhausted');
  assert.equal(daily.reason, FUNDED_DENIED.DAILY_EXHAUSTED);
  assert.match(daily.message, /refills tomorrow/i);

  const platform = fundedMeterMessage('global_ceiling_exceeded');
  assert.equal(platform.reason, FUNDED_DENIED.PLATFORM_CEILING);
  assert.match(platform.message, /busy/i);

  // An unrecognised reason must still produce something sayable rather
  // than undefined leaking into the chat view.
  const unknown = fundedMeterMessage('something-new');
  assert.ok(unknown.message && unknown.message.length > 0);
});
