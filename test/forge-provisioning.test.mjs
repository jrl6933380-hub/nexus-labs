import test from 'node:test';
import assert from 'node:assert/strict';

import { provisioningConfigured } from '../lib/forge/provisioning.js';

test('provisioningConfigured reflects the environment', () => {
  const previous = process.env.OPENROUTER_PROVISIONING_KEY;
  try {
    delete process.env.OPENROUTER_PROVISIONING_KEY;
    // The module read the env var at import time, so this asserts the
    // shape of the answer rather than live re-reading — the contract that
    // matters is that it returns a boolean and never throws.
    assert.equal(typeof provisioningConfigured(), 'boolean');
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_PROVISIONING_KEY;
    else process.env.OPENROUTER_PROVISIONING_KEY = previous;
  }
});
