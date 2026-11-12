import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutLineItems,readInvoice,FORGE_PRICE_IDS} from '../lib/forgeStripe.js';
import {LAUNCH_OFFER} from '../lib/forgeProgram.js';

test('launch Checkout bills $25/month recurring plus $25 one-time setup ($50 first invoice)',()=>{
  const items=checkoutLineItems({tier:'launch'},{});
  assert.equal(items.length,2);
  const [monthly,setup]=items.map(i=>i.price_data);
  assert.equal(monthly.unit_amount,2500);assert.deepEqual(monthly.recurring,{interval:'month'});
  assert.equal(setup.unit_amount,2500);assert.equal(setup.recurring,undefined);
  assert.equal(monthly.currency,'usd');
  assert.equal(monthly.unit_amount+setup.unit_amount,5000);
  assert.equal(LAUNCH_OFFER.signUpCents,5000);
  assert.equal(LAUNCH_OFFER.monthlyCents,2500);
  assert.equal(LAUNCH_OFFER.activationCents,2500);
  // old env price IDs (the $10 prices) must never be used
  const old=checkoutLineItems({tier:'launch'},{FORGE_LAUNCH_MONTHLY_PRICE:'price_old',FORGE_LAUNCH_ACTIVATION_PRICE:'price_old2'});
  assert.ok(!JSON.stringify(old).includes('price_old'));
});

test('existing customer price IDs are untouched; invalid tiers fail before contacting Stripe',()=>{
  for(const tier of ['basic','standard','plus'])assert.deepEqual(checkoutLineItems({tier}),[{price:FORGE_PRICE_IDS[tier],quantity:1}]);
  assert.throws(()=>checkoutLineItems({tier:'fake'}),/No Stripe price/);
});

test('invoice parsing associates launch first payment and renewal with same Forge client',()=>{
  const first=readInvoice({id:'in_first',customer:'cus_123',amount_paid:5000,billing_reason:'subscription_create',parent:{subscription_details:{subscription:'sub_123',metadata:{forge_client_id:'forge_test'}}}});
  const renewal=readInvoice({id:'in_next',customer:'cus_123',amount_paid:2500,billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_123',metadata:{forge_client_id:'forge_test'}}}});
  assert.equal(first.isFirst,true);assert.equal(renewal.isFirst,false);
  assert.equal(first.forgeClientId,'forge_test');assert.equal(renewal.forgeClientId,'forge_test');
  assert.equal(first.amountPaidCents,5000);assert.equal(renewal.amountPaidCents,2500);
});
