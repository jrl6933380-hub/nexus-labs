import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';

const { attachResult } = await import('../lib/board.js');

function fakeStore(initial) {
  let stored = JSON.stringify(initial);
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'HGET') {
      return { ok: true, async json() { return { result: stored }; } };
    }
    if (command[0] === 'HSET') {
      stored = command[3];
      return { ok: true, async json() { return { result: 1 }; } };
    }
    throw new Error(`unexpected command ${command[0]}`);
  };
  return () => JSON.parse(stored);
}

test('attachResult clears a stale claim_check flag once the corrected result no longer matches a mismatch phrase', async () => {
  const getStored = fakeStore({
    id: 'abc123',
    title: 'Show subscription tiers after Forge signup',
    status: 'complete',
    result: 'old note said not yet wired',
    last_note: null,
    claim_check: { flagged: true, matched_phrase: 'not yet wired', flagged_at: 1 },
  });

  await attachResult({
    id: 'abc123',
    result: 'Verified complete via direct code read: checkout is live and Stripe-backed. Sweep mismatch was a false positive.',
  });

  const saved = getStored();
  assert.equal(saved.claim_check, undefined);
  assert.match(saved.result, /false positive/);
});

test('attachResult sets a fresh claim_check flag when the new result itself admits incomplete work', async () => {
  const getStored = fakeStore({
    id: 'xyz789',
    title: 'Some task',
    status: 'complete',
    result: null,
    last_note: null,
  });

  await attachResult({ id: 'xyz789', result: 'Still needs the billing webhook wired up.' });

  const saved = getStored();
  assert.equal(saved.claim_check.flagged, true);
  assert.equal(saved.claim_check.matched_phrase, 'still needs');
});

test('attachResult leaves claim_check untouched (absent) when nothing ever matched', async () => {
  const getStored = fakeStore({ id: 'clean1', title: 'Clean task', status: 'complete', result: null, last_note: null });

  await attachResult({ id: 'clean1', result: 'All good, shipped and verified.' });

  const saved = getStored();
  assert.equal(saved.claim_check, undefined);
});
