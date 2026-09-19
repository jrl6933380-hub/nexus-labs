import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FORGE_ENCRYPTION_KEY ||= 'f'.repeat(64);

const { encryptSecret, decryptSecret } = await import('../lib/forge/brainStore.js');
const {
  STATES, canTransition, transition, deriveState, describe, RECOVERY,
} = await import('../lib/forge/onboardingMachine.js');
const { getAdapter, listAdapters, modelForTier } = await import('../lib/forge/brainProviders.js');

// --- secrets ---------------------------------------------------------------

test('a provider key round-trips through encryption', () => {
  const key = 'sk-or-v1-abc123def456';
  const sealed = encryptSecret(key);
  assert.notEqual(sealed, key);
  assert.ok(!sealed.includes(key), 'the plaintext key must not appear in the stored value');
  assert.equal(decryptSecret(sealed), key);
});

test('every encryption uses a fresh IV', () => {
  const a = encryptSecret('same-key');
  const b = encryptSecret('same-key');
  assert.notEqual(a, b, 'identical plaintext must not produce identical ciphertext');
  assert.equal(decryptSecret(a), decryptSecret(b));
});

test('tampered ciphertext is rejected rather than silently decrypted', () => {
  const sealed = encryptSecret('sk-or-v1-tamper');
  const parts = sealed.split('.');
  const flipped = Buffer.from(parts[3], 'base64');
  flipped[0] ^= 0xff;
  parts[3] = flipped.toString('base64');
  assert.throws(() => decryptSecret(parts.join('.')));
});

test('a malformed secret is rejected', () => {
  assert.throws(() => decryptSecret('not-a-secret'));
  assert.throws(() => decryptSecret('v2.a.b.c'));
});

test('a missing encryption key fails loudly instead of storing plaintext', async () => {
  const original = process.env.FORGE_ENCRYPTION_KEY;
  delete process.env.FORGE_ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptSecret('sk-or-v1-x'), /FORGE_ENCRYPTION_KEY/);
  } finally {
    process.env.FORGE_ENCRYPTION_KEY = original;
  }
});

test('an encryption key of the wrong size is rejected', async () => {
  const original = process.env.FORGE_ENCRYPTION_KEY;
  process.env.FORGE_ENCRYPTION_KEY = 'too-short';
  try {
    assert.throws(() => encryptSecret('sk-or-v1-x'), /32 bytes/);
  } finally {
    process.env.FORGE_ENCRYPTION_KEY = original;
  }
});

// --- state machine ---------------------------------------------------------

test('onboarding state is derived from facts, so a refresh lands on the same step', () => {
  const facts = { hasAccount: true, acceptedTerms: true, hasConnection: false };
  assert.equal(deriveState(facts), STATES.BRAIN_SELECTION);
  assert.equal(deriveState(facts), STATES.BRAIN_SELECTION, 'deriving twice gives the same answer');
});

test('an in-flight authorization is not lost by returning to selection', () => {
  assert.equal(
    deriveState({ hasAccount: true, acceptedTerms: true, hasConnection: false, authorizationPending: true }),
    STATES.PROVIDER_AUTHORIZATION
  );
});

test('a connection that has not been tested lands on the test step', () => {
  assert.equal(
    deriveState({ hasAccount: true, acceptedTerms: true, hasConnection: true, connectionTested: false }),
    STATES.CONNECTION_TEST
  );
  assert.equal(
    deriveState({ hasAccount: true, acceptedTerms: true, hasConnection: true, connectionTested: true }),
    STATES.READY
  );
});

test('missing prerequisites route to the right step', () => {
  assert.equal(deriveState({ hasAccount: false }), STATES.ACCOUNT_REQUIRED);
  assert.equal(deriveState({ hasAccount: true, acceptedTerms: false }), STATES.TERMS_REQUIRED);
});

test('an error always routes to recovery', () => {
  assert.equal(
    deriveState({ hasAccount: true, acceptedTerms: true, hasConnection: true, connectionTested: true, error: 'x' }),
    STATES.ERROR_RECOVERY
  );
});

test('invalid transitions are refused', () => {
  assert.ok(canTransition(STATES.BRAIN_SELECTION, STATES.PROVIDER_AUTHORIZATION));
  assert.ok(!canTransition(STATES.BRAIN_SELECTION, STATES.READY), 'cannot skip authorization');
  assert.throws(() => transition(STATES.WELCOME, STATES.CONNECTION_TEST));
});

test('error recovery is never a dead end', () => {
  const moves = [STATES.BRAIN_SELECTION, STATES.PROVIDER_AUTHORIZATION, STATES.CONNECTION_TEST];
  for (const move of moves) {
    assert.ok(canTransition(STATES.ERROR_RECOVERY, move), `recovery must be able to reach ${move}`);
  }
});

test('every state has something to say and a way forward', () => {
  for (const state of Object.values(STATES)) {
    const step = describe(state, { tiers: getAdapter('openrouter').tiers });
    assert.ok(step.say.length > 0, `${state} must have copy`);
    assert.ok(step.actions.length > 0, `${state} must offer at least one action`);
  }
});

test('onboarding copy avoids developer jargon', () => {
  const jargon = ['OAuth', 'PKCE', 'API key', 'token', 'endpoint', 'provider-hosted'];
  for (const state of Object.values(STATES)) {
    const { say } = describe(state, { tiers: getAdapter('openrouter').tiers });
    for (const word of jargon) {
      assert.ok(!say.includes(word), `${state} copy should not contain "${word}"`);
    }
  }
});

test('every recovery reason names a next move', () => {
  for (const [reason, text] of Object.entries(RECOVERY)) {
    assert.ok(text.length > 0, `${reason} needs copy`);
    assert.ok(/try again|reconnect|starting it again|nothing was connected/i.test(text),
      `${reason} should tell the user what to do`);
  }
});

// --- provider adapter ------------------------------------------------------

test('authorization sends a challenge and keeps the verifier server-side', () => {
  const adapter = getAdapter('openrouter');
  const { redirectUrl, state, codeVerifier } = adapter.beginAuthorization({
    callbackUrl: 'https://example.com/api/forge-brain-callback',
  });
  const url = new URL(redirectUrl);
  assert.equal(url.origin + url.pathname, 'https://openrouter.ai/auth');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(state && codeVerifier);
  assert.ok(!redirectUrl.includes(codeVerifier), 'the verifier must never appear in the redirect');
});

test('each authorization is unique, so one cannot be replayed as another', () => {
  const adapter = getAdapter('openrouter');
  const a = adapter.beginAuthorization({ callbackUrl: 'https://example.com/cb' });
  const b = adapter.beginAuthorization({ callbackUrl: 'https://example.com/cb' });
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.codeVerifier, b.codeVerifier);
});

test('authorization requires a callback url', () => {
  assert.throws(() => getAdapter('openrouter').beginAuthorization({}), /callbackUrl/);
});

test('an unknown provider is refused rather than defaulted', () => {
  assert.throws(() => getAdapter('definitely-not-real'), /Unknown brain provider/);
});

test('tiers map to models and fall back to the first tier', () => {
  assert.match(modelForTier('openrouter', 'strong'), /anthropic/);
  assert.equal(modelForTier('openrouter', 'nonsense'), modelForTier('openrouter', 'free'));
});

test('the advertised providers expose tiers without leaking internals', () => {
  const [provider] = listAdapters();
  assert.equal(provider.id, 'openrouter');
  assert.ok(Array.isArray(provider.tiers) && provider.tiers.length === 3);
  assert.equal(typeof provider.beginAuthorization, 'undefined', 'adapter functions must not be serialised outward');
});
