import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_GRANT_SIGNING_SECRET = process.env.NEXUS_GRANT_SIGNING_SECRET || 'test-secret-for-unit-tests';

const { createOAuthState, verifyOAuthState } = await import('../lib/oauthState.js');

test('creates and verifies a valid state token', () => {
  const token = createOAuthState({ tenant_id: 't1', owner: 'justin', provider: 'github' });
  const payload = verifyOAuthState(token);
  assert.equal(payload.tenant_id, 't1');
  assert.equal(payload.owner, 'justin');
  assert.equal(payload.provider, 'github');
});

test('rejects a tampered state token', () => {
  const token = createOAuthState({ tenant_id: 't1', owner: 'justin', provider: 'github' });
  const tampered = token.slice(0, -2) + 'xx';
  assert.throws(() => verifyOAuthState(tampered));
});

test('rejects an expired state token', () => {
  const token = createOAuthState({ tenant_id: 't1', owner: 'justin', provider: 'github', ttl_ms: -1000 });
  assert.throws(() => verifyOAuthState(token), /Expired/);
});

test('rejects a missing state token', () => {
  assert.throws(() => verifyOAuthState(undefined));
  assert.throws(() => verifyOAuthState(''));
});

test('requires tenant_id, owner, and provider to create a state', () => {
  assert.throws(() => createOAuthState({ owner: 'justin', provider: 'github' }));
  assert.throws(() => createOAuthState({ tenant_id: 't1', provider: 'github' }));
  assert.throws(() => createOAuthState({ tenant_id: 't1', owner: 'justin' }));
});
