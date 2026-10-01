import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS } from '../lib/roomAuth.js';
import { workbenchProjectAllowance } from '../lib/workbenchPlans.js';

test('Nex Chat project allowances match Free, Pro, and Plus product limits', () => {
  assert.deepEqual(workbenchProjectAllowance(PLANS.FREE), { limit: 0, planName: 'Free' });
  assert.deepEqual(workbenchProjectAllowance(PLANS.HOSTED), { limit: 3, planName: 'Pro' });
  assert.deepEqual(workbenchProjectAllowance(PLANS.GROWTH), { limit: 10, planName: 'Plus' });
  assert.deepEqual(workbenchProjectAllowance(PLANS.UNLIMITED), { limit: 10, planName: 'Plus' });
  assert.deepEqual(workbenchProjectAllowance(PLANS.FREE, true), { limit: 10, planName: 'Plus' });
});
