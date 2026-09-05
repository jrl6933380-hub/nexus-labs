import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoleLeaseInput } from '../lib/roleLease.js';

test('provider-neutral role lease requires truthful provenance', () => {
  assert.doesNotThrow(() => validateRoleLeaseInput({
    agent_id: 'claude-routine',
    provider: 'anthropic',
    model: 'claude-sonnet',
    approval_boundary: 'same_as_nex',
  }));
  assert.throws(() => validateRoleLeaseInput({
    agent_id: 'claude-routine',
    provider: 'anthropic',
    model: '',
  }), /provider and model/);
  assert.throws(() => validateRoleLeaseInput({
    agent_id: 'nex',
    provider: 'nexus',
    model: 'orchestrator',
  }), /cannot lease/);
  assert.throws(() => validateRoleLeaseInput({
    agent_id: 'worker',
    provider: 'provider',
    model: 'model',
    approval_boundary: 'elevated',
  }), /approval_boundary/);
});
