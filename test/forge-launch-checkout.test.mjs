import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutLineItems,readInvoice,FORGE_PRICE_IDS} from '../lib/forgeStripe.js';
import {LAUNCH_OFFER} from '../lib/forgeProgram.js';

test('launch Stripe Checkout is a $20 first invoice and $10 subsequent month',()=>{
  const items=checkoutLineItems({tier:'launch'});
  assert.equal(items.length,2);
  assert.equal(items[0].price_data.recurring.interval,'month');
  assert.equal(items[0].price_data.unit_amount,1000);
  assert.equal(items[1].price_data.unit_amount,1000);
  assert.equal(items[1].price_data.recurring,undefined);
  assert.equal(items.reduce((sum,i)=>sum+i.price_data.unit_amount*i.quantity,0),LAUNCH_OFFER.signUpCents);
  assert.equal(items.filter(i=>i.price_data.recurring).reduce((sum,i)=>sum+i.price_data.unit_amount*i.quantity,0),LAUNCH_OFFER.monthlyCents);
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
