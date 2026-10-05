import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHash } from '../lib/codeVault.js';

test('REGRESSION: normalizeHash converts Upstash-style flat array to an object', () => {
  // This is the exact shape that broke search_vault in production:
  // Upstash's REST API HGETALL returns a flat array of alternating
  // field/value strings, not a nested object. The old code treated
  // the array as already-keyed, which fed field NAMES into
  // JSON.parse as if they were values.
  const flatArray = [
    'nexus:vault:blueprint:business-site-shell',
    '{"level":"blueprint","name":"Business Site Shell","slug":"business-site-shell"}',
    'nexus:vault:blueprint:agent-dashboard-shell',
    '{"level":"blueprint","name":"Agent Dashboard Shell","slug":"agent-dashboard-shell"}',
  ];

  const result = normalizeHash(flatArray);

  assert.deepEqual(Object.keys(result), [
    'nexus:vault:blueprint:business-site-shell',
    'nexus:vault:blueprint:agent-dashboard-shell',
  ]);
  assert.equal(
    result['nexus:vault:blueprint:business-site-shell'],
    '{"level":"blueprint","name":"Business Site Shell","slug":"business-site-shell"}'
  );

  // The actual failure mode: parsing a raw field name as JSON must
  // never happen once normalizeHash has run.
  const values = Object.values(result);
  for (const v of values) {
    assert.doesNotThrow(() => JSON.parse(v), `expected valid JSON, got: ${v}`);
  }
});

test('normalizeHash passes through an already-object shape unchanged (in-memory store case)', () => {
  const alreadyObject = { 'some:key': '{"a":1}' };
  assert.deepEqual(normalizeHash(alreadyObject), alreadyObject);
});

test('normalizeHash handles null/undefined/empty gracefully', () => {
  assert.deepEqual(normalizeHash(null), {});
  assert.deepEqual(normalizeHash(undefined), {});
  assert.deepEqual(normalizeHash([]), {});
});
