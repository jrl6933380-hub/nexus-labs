import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { signInOperator } from '../public/nex-operator-sign-in.js';

const reply = (ok, data) => ({ ok, json: async () => data });
test('operator login verifies saved cookie after credentials', async () => {
  const calls = [];
  assert.equal(await signInOperator(' owner ', 'test-only', async (url, options) => {
    calls.push({ url, options });
    return reply(true, { operator: true });
  }), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'operator-login', username: 'owner', password: 'test-only' });
  assert.equal(calls[1].options.cache, 'no-store');
});
test('customer session and rejected credentials cannot authorize dashboard', async () => {
  for (const response of [reply(true, { operator: false }), reply(false, { error: 'Wrong credentials' })]) {
    await assert.rejects(signInOperator('customer', 'test', async () => response));
  }
});
test('blocked cookies cannot be reported as login success', async () => {
  let calls = 0;
  await assert.rejects(signInOperator('owner', 'test', async () => ++calls === 1
    ? reply(true, { operator: true }) : reply(false, {})), /session was not saved/);
});
test('chat restores draft and opens in-place login without navigating', async () => {
  const source = await readFile(new URL('../public/nex-chat-bar.js', import.meta.url), 'utf8');
  assert.match(source, /input.value = typedText;\s*const signedIn = await requestOperatorSignIn\(\)/);
  assert.doesNotMatch(source, /if \(redirectToOperatorLogin\(response, window.location\)\)/);
});
