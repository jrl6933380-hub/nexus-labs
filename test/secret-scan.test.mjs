import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactFields } from '../lib/secretScan.js';

test('redacts a GitHub personal access token', () => {
  const { text, redacted, matchedPatterns } = redactSecrets('token is ghp_abcdefghijklmnopqrstuvwxyz0123456789 ok');
  assert.equal(redacted, true);
  assert.deepEqual(matchedPatterns, ['github_token']);
  assert.ok(!text.includes('ghp_'));
  assert.ok(text.includes('[REDACTED-POSSIBLE-SECRET]'));
});

test('redacts an AWS access key id', () => {
  const { text, redacted } = redactSecrets('key AKIAABCDEFGHIJKLMNOP leaked');
  assert.equal(redacted, true);
  assert.ok(!text.includes('AKIA'));
});

test('redacts a Stripe secret key', () => {
  const { text, redacted } = redactSecrets('sk_live_abcdefghij1234567890 was in the payload');
  assert.equal(redacted, true);
  assert.ok(!/sk_live_/.test(text));
});

test('redacts an OpenAI-style key', () => {
  const { text, redacted } = redactSecrets('sk-abcdefghijklmnopqrstuvwxyz012345 appeared');
  assert.equal(redacted, true);
});

test('redacts a JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const { text, redacted } = redactSecrets('auth failed for ' + jwt);
  assert.equal(redacted, true);
  assert.ok(!text.includes('eyJ'));
});

test('redacts a Bearer token', () => {
  const { text, redacted } = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(redacted, true);
  assert.ok(!/Bearer\s+[A-Za-z0-9]/.test(text));
});

test('does NOT redact a plain 40-character git commit SHA', () => {
  const { text, redacted } = redactSecrets('production deployment at 3b6c2a6edc3590229cac8d3610e37b9fa050d6c9');
  assert.equal(redacted, false);
  assert.equal(text, 'production deployment at 3b6c2a6edc3590229cac8d3610e37b9fa050d6c9');
});

test('does NOT redact a Vercel deployment id', () => {
  const { text, redacted } = redactSecrets('deployment dpl_8FpTeossyG8Z6ZGYAvDTARJJbGp2 is READY');
  assert.equal(redacted, false);
});

test('leaves ordinary text completely untouched', () => {
  const { text, redacted, matchedPatterns } = redactSecrets('PR #59 merged, tests 6/6 passing');
  assert.equal(redacted, false);
  assert.equal(matchedPatterns.length, 0);
  assert.equal(text, 'PR #59 merged, tests 6/6 passing');
});

test('redactFields redacts across multiple fields and reports a combined flag', () => {
  const { fields, secret_check } = redactFields({
    description: 'safe text',
    blocked_reason: 'failed with token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  });
  assert.equal(fields.description, 'safe text');
  assert.ok(!fields.blocked_reason.includes('ghp_'));
  assert.equal(secret_check.flagged, true);
  assert.deepEqual(secret_check.matched_patterns, ['github_token']);
});

test('redactFields returns null secret_check when nothing matched', () => {
  const { fields, secret_check } = redactFields({ description: 'all clear', result: 'also clear' });
  assert.equal(fields.description, 'all clear');
  assert.equal(secret_check, null);
});

test('redactFields ignores non-string fields safely', () => {
  const { fields, secret_check } = redactFields({ owner: 'claude', count: 5, ok: true });
  assert.equal(fields.owner, 'claude');
  assert.equal(fields.count, 5);
  assert.equal(fields.ok, true);
  assert.equal(secret_check, null);
});
