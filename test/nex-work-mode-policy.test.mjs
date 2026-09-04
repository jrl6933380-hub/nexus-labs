import test from 'node:test';
import assert from 'node:assert/strict';
import { getNexRuntimePolicy } from '../lib/nexRuntimePolicy.js';

test('Nex work-mode policy is decisive without inventing tools', () => {
  const policy = getNexRuntimePolicy();
  assert.match(policy, /use every relevant tool/i);
  assert.match(policy, /do not wait, delegate, or ask repeated permission/i);
  assert.match(policy, /non-live branch/i);
  assert.match(policy, /only the supplied tool list proves access/i);
  assert.match(policy, /Never call a proposal shipped/i);
});
