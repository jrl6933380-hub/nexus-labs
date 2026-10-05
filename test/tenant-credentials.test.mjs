import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_GRANT_SIGNING_SECRET = process.env.NEXUS_GRANT_SIGNING_SECRET || 'test-secret-for-unit-tests';
process.env.KV_REST_API_URL = 'https://example-fake-redis.invalid';
process.env.KV_REST_API_TOKEN = 'fake-token-for-unit-tests';

const { __internals } = await import('../lib/tenantCredentials.js');

test('encrypt then decrypt round-trips the original plaintext', () => {
  const plaintext = JSON.stringify({ accessToken: 'ghu_exampletoken123', refreshToken: null, expiresAt: null });
  const encrypted = __internals.encrypt(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.ok(!encrypted.includes('ghu_exampletoken123'));
  const decrypted = __internals.decrypt(encrypted);
  assert.equal(decrypted, plaintext);
});

test('two encryptions of the same plaintext produce different ciphertext (random IV)', () => {
  const plaintext = 'same-value';
  const a = __internals.encrypt(plaintext);
  const b = __internals.encrypt(plaintext);
  assert.notEqual(a, b);
  assert.equal(__internals.decrypt(a), plaintext);
  assert.equal(__internals.decrypt(b), plaintext);
});

test('decrypting a tampered ciphertext throws (auth tag mismatch)', () => {
  const encrypted = __internals.encrypt('some-secret-value');
  const buf = Buffer.from(encrypted, 'base64');
  buf[buf.length - 1] ^= 0xff; // flip a bit in the ciphertext
  const tampered = buf.toString('base64');
  assert.throws(() => __internals.decrypt(tampered));
});


test('dedicated credential key produces versioned ciphertext and round-trips', () => {
  const previous = process.env.NEXUS_CREDENTIAL_ENC_KEY;
  process.env.NEXUS_CREDENTIAL_ENC_KEY = 'dedicated-test-key';
  try {
    const encrypted = __internals.encrypt('new-secret');
    assert.match(encrypted, /^v2:/);
    assert.equal(__internals.decrypt(encrypted), 'new-secret');
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CREDENTIAL_ENC_KEY;
    else process.env.NEXUS_CREDENTIAL_ENC_KEY = previous;
  }
});

test('dedicated key migration still reads legacy unprefixed ciphertext', () => {
  const previous = process.env.NEXUS_CREDENTIAL_ENC_KEY;
  delete process.env.NEXUS_CREDENTIAL_ENC_KEY;
  const legacy = __internals.encrypt('existing-secret');
  process.env.NEXUS_CREDENTIAL_ENC_KEY = 'dedicated-test-key';
  try {
    assert.equal(__internals.decrypt(legacy), 'existing-secret');
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CREDENTIAL_ENC_KEY;
    else process.env.NEXUS_CREDENTIAL_ENC_KEY = previous;
  }
});

test('v2 credentials fail closed if the dedicated key is unavailable', () => {
  const previous = process.env.NEXUS_CREDENTIAL_ENC_KEY;
  process.env.NEXUS_CREDENTIAL_ENC_KEY = 'dedicated-test-key';
  const encrypted = __internals.encrypt('new-secret');
  delete process.env.NEXUS_CREDENTIAL_ENC_KEY;
  try {
    assert.throws(() => __internals.decrypt(encrypted), /NEXUS_CREDENTIAL_ENC_KEY/);
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CREDENTIAL_ENC_KEY;
    else process.env.NEXUS_CREDENTIAL_ENC_KEY = previous;
  }
});
