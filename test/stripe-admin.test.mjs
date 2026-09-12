import test from 'node:test';
import assert from 'node:assert/strict';

import { describeBillingAction, validateBillingAction } from '../lib/stripeAdmin.js';
import { TOOLS } from '../lib/nexBrain.js';

test('billing mutations exposed to Nex are proposal-only actions', () => {
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
  assert.ok(byName.has('propose_stripe_action'));
  assert.ok(byName.has('get_stripe_object'));
  assert.deepEqual(byName.get('propose_stripe_action').input_schema.required, ['action', 'reason']);
});

test('validates supported billing actions and produces approval descriptions', () => {
  assert.equal(
    describeBillingAction({ action: 'refund_payment', payment_intent: 'pi_123', amount_cents: 250 }),
    'Refund Stripe payment pi_123 by 250 cents'
  );
  assert.deepEqual(
    validateBillingAction({ action: 'set_user_plan', username: 'Mrlopez', plan: 'growth' }),
    { action: 'set_user_plan', username: 'Mrlopez', plan: 'growth' }
  );
});

test('rejects unapproved shapes and unsafe values before queueing', () => {
  assert.throws(() => validateBillingAction({ action: 'create_charge', amount_cents: 1 }), /Unsupported/);
  assert.throws(() => validateBillingAction({ action: 'refund_payment', payment_intent: 'bad' }), /Invalid payment/);
  assert.throws(() => validateBillingAction({ action: 'grant_bonus_credits', username: 'Mrlopez', credits: 0 }), /Credits/);
});
