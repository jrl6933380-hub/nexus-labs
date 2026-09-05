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
