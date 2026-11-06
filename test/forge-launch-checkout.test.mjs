import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutLineItems,readInvoice,FORGE_PRICE_IDS} from '../lib/forgeStripe.js';
import {LAUNCH_OFFER} from '../lib/forgeProgram.js';

test('launch Checkout uses separate recurring and one-time Stripe prices',()=>{
  // Stripe price objects on the connected account have been independently
  // verified: $10/month recurring and $10 activation one time.
  const env={FORGE_LAUNCH_MONTHLY_PRICE:'price_monthly_test',FORGE_LAUNCH_ACTIVATION_PRICE:'price_activation_test'};
  const items=checkoutLineItems({tier:'launch'},env);
  assert.deepEqual(items,[{price:'price_monthly_test',quantity:1},{price:'price_activation_test',quantity:1}]);
  assert.equal(LAUNCH_OFFER.signUpCents,2000);
  assert.equal(LAUNCH_OFFER.monthlyCents,1000);
  assert.equal(LAUNCH_OFFER.activationCents,1000);
  assert.throws(()=>checkoutLineItems({tier:'launch'},{}),/not configured/);
  assert.throws(()=>checkoutLineItems({tier:'launch',id:'test'},{FORGE_LAUNCH_MONTHLY_PRICE:'price_only_month'}),/not configured/);
});

test('existing customer price IDs are untouched; invalid tiers fail before contacting Stripe',()=>{
  for(const tier of ['basic','standard','plus'])assert.deepEqual(checkoutLineItems({tier}),[{price:FORGE_PRICE_IDS[tier],quantity:1}]);
  assert.throws(()=>checkoutLineItems({tier:'fake'}),/No Stripe price/);
});

test('invoice parsing associates launch first payment and renewal with same Forge client',()=>{
  const first=readInvoice({id:'in_first',customer:'cus_123',amount_paid:2000,billing_reason:'subscription_create',parent:{subscription_details:{subscription:'sub_123',metadata:{forge_client_id:'forge_test'}}}});
  const renewal=readInvoice({id:'in_next',customer:'cus_123',amount_paid:1000,billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_123',metadata:{forge_client_id:'forge_test'}}}});
  assert.equal(first.isFirst,true);assert.equal(renewal.isFirst,false);
  assert.equal(first.forgeClientId,'forge_test');assert.equal(renewal.forgeClientId,'forge_test');
  assert.equal(first.amountPaidCents,2000);assert.equal(renewal.amountPaidCents,1000);
});
