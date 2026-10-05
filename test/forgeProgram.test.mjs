import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signupBonusCents, recurringCommissionCents, upgradeBonusCents,
  editsRemaining, cancelTimeline, reactivationTiers, validateBatch,
} from '../lib/forgeProgram.js';

// Shaped like a forge_callers row: Postgres numerics arrive as strings.
const james = {
  signup_bonus_basic: '10.00', signup_bonus_standard: '20.00', signup_bonus_plus: '35.00',
  recurring_pct: '0.1500', upgrade_bonus: '10.00',
};

test('signup bonus scales with tier', () => {
  assert.equal(signupBonusCents(james, 'basic'), 1000);
  assert.equal(signupBonusCents(james, 'standard'), 2000);
  assert.equal(signupBonusCents(james, 'plus'), 3500);
  assert.throws(() => signupBonusCents(james, 'gold'));
});

test('recurring is 15% of what was actually paid', () => {
  assert.equal(recurringCommissionCents(james, 2900), 435);
  assert.equal(recurringCommissionCents(james, 4900), 735);
  assert.equal(recurringCommissionCents(james, 7900), 1185);
  assert.equal(recurringCommissionCents(james, 0), 0);
});

test('upgrade bonus pays per tier jumped, never on downgrade', () => {
  assert.equal(upgradeBonusCents(james, 'basic', 'standard'), 1000);
  assert.equal(upgradeBonusCents(james, 'basic', 'plus'), 2000);
  assert.equal(upgradeBonusCents(james, 'plus', 'basic'), 0);
});

test('edit allowance plus top-ups', () => {
  assert.equal(editsRemaining({ tier: 'basic', allotmentUsedThisMonth: 1 }), 0);
  assert.equal(editsRemaining({ tier: 'basic', allotmentUsedThisMonth: 1, topupGranted: 3, topupUsed: 1 }), 2);
  assert.equal(editsRemaining({ tier: 'plus', allotmentUsedThisMonth: 40 }), Infinity);
});

test('cancel timeline: placeholder day 3, follow-up day 14', () => {
  const t = cancelTimeline('2026-10-01T12:00:00Z');
  assert.equal(t.placeholderAt.toISOString(), '2026-10-04T12:00:00.000Z');
  assert.equal(t.followupDueAt.toISOString(), '2026-10-15T12:00:00.000Z');
});

test('reactivation allows same tier or lower only', () => {
  assert.deepEqual(reactivationTiers('standard'), ['basic', 'standard']);
  assert.deepEqual(reactivationTiers('basic'), ['basic']);
});

test('batches dedupe and cap at 5', () => {
  assert.equal(validateBatch(['a', 'b', 'a']).length, 2);
  assert.throws(() => validateBatch([]));
  assert.throws(() => validateBatch(['1', '2', '3', '4', '5', '6']));
});
