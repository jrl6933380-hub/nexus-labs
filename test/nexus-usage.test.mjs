import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createNexusUsage} from '../lib/nexusUsage.js';
import {fulfillUsagePack} from '../lib/billingPlans.js';
import {createCheckoutHandler} from '../api/checkout.js';
import {createUsageHandler} from '../api/room-usage.js';
import {createLifeHandler} from '../api/board.js';
const luaProbe=spawnSync('python',['-c',"import ctypes.util,sys;sys.exit(0 if any(ctypes.util.find_library(n) for n in ['lua5.4','lua5.3']) else 77)"]);
const ledgerOptions={skip:luaProbe.status!==0?'Ledger integration tests require Python and system Lua 5.3/5.4':false};
function fixture(){
 let clock=Date.parse('2026-10-10T23:00:00Z'),store={},tail=Promise.resolve();
 const command=parts=>{const promise=tail.then(()=>{const r=spawnSync('python',['test/helpers/usage-lua.py'],{input:JSON.stringify({command:parts,store}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);const data=JSON.parse(r.stdout);store=data.store;return data.result;});tail=promise.catch(()=>{});return promise;};
 const meter=createNexusUsage({command,now:()=>clock,resolvePlan:async user=>user==='pro'?'hosted':user==='plus'?'growth':'free',isExempt:u=>u==='owner',limits:{free:{short:2,weekly:3},hosted:{short:4,weekly:6},growth:{short:8,weekly:12}}});
 return {meter,advance:ms=>clock+=ms};
}
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('production Lua enforces both windows atomically, tier differences, and isolated accounts',ledgerOptions,async()=>{
 const {meter,advance}=fixture();
 const reservations=await Promise.all(Array.from({length:4},()=>meter.reserveBuild({userId:'free'})));
 assert.equal(reservations.filter(r=>r.ok).length,2);
 assert.equal((await meter.summary('free')).short.percentRemaining,0);
 assert.equal((await meter.summary('pro')).short.percentRemaining,100);
 assert.equal((await meter.summary('plus')).plan,'Plus');
 advance(5*3600000);assert.equal((await meter.summary('free')).short.percentRemaining,100);
 assert.equal((await meter.summary('free')).weekly.percentRemaining,33);
 assert.equal((await meter.reserveBuild({userId:'free'})).ok,true);assert.equal((await meter.reserveBuild({userId:'free'})).ok,false);
 advance(7*86400000);assert.equal((await meter.summary('free')).weekly.percentRemaining,100);
});
test('paid packs carry forward, fulfill once, require opt-in, and yield to included usage',ledgerOptions,async()=>{
 const {meter,advance}=fixture();await meter.grantBonusCredits('free',3,{purchaseId:'cs_paid'});await meter.grantBonusCredits('free',3,{purchaseId:'cs_paid'});
 await meter.reserveBuild({userId:'free'});await meter.reserveBuild({userId:'free'});
 assert.equal((await meter.reserveBuild({userId:'free'})).ok,false);await meter.setExtraEnabled('free',true);
 const extra=await meter.reserveBuild({userId:'free'});assert.equal(extra.source,'extra');assert.equal((await meter.summary('free')).extra.percentRemaining,66);
 advance(5*3600000);const included=await meter.reserveBuild({userId:'free'});assert.equal(included.source,'included');assert.equal((await meter.summary('free')).extra.percentRemaining,66);
 advance(8*86400000);assert.equal((await meter.summary('free')).extra.percentRemaining,66);
 await assert.rejects(meter.grantBonusCredits('free',3),/paid purchase/);
});
test('settlement refunds failures once, preserves extra balance, and cannot refund a new window',ledgerOptions,async()=>{
 const {meter,advance}=fixture();const hold=await meter.reserveBuild({userId:'free',requestId:'same'});
 assert.equal((await meter.reserveBuild({userId:'free',requestId:'same'})).ok,false);
 await meter.settleBuild({userId:'free',reservationId:hold.reservationId,success:false});await meter.settleBuild({userId:'free',reservationId:hold.reservationId,success:false});assert.equal((await meter.summary('free')).short.percentRemaining,100);
 const old=await meter.reserveBuild({userId:'free'});advance(5*3600000);await meter.reserveBuild({userId:'free'});await meter.settleBuild({userId:'free',reservationId:old.reservationId,success:false});assert.equal((await meter.summary('free')).short.percentRemaining,50);
 assert.equal((await meter.summary('owner')).exempt,true);
});
test('public usage exposes percentages and reset times, not raw units; extra toggles require authentication',ledgerOptions,async()=>{
 const {meter}=fixture(),res=response(),handler=createUsageHandler({resolveUser:async()=> 'pro',meter,resolvePlan:async()=> 'hosted'});
 await handler({method:'GET'},res);assert.equal(res.code,200);assert.equal(res.body.usageLimits.short.percentRemaining,100);
 assert.doesNotMatch(JSON.stringify(res.body),/"(?:credits|consumed|spent|reserved|granted|remaining|limit)":/);
 await createUsageHandler({resolveUser:async()=>null,meter})({method:'POST',body:{action:'extra_usage',enabled:true}},res);assert.equal(res.code,401);
});
test('checkout uses server prices and account metadata; pack does not change the plan',async()=>{
 const calls=[],res=response(),handler=createCheckoutHandler({resolveUser:async()=> 'pro',resolvePlan:async()=> 'free',configured:()=>true,request:async(path,body)=>{calls.push(body);return {url:'https://checkout.stripe.com/test'};}});
 await handler({method:'POST',body:{priceId:'nexus_pro_monthly',amount:1,username:'attacker'}},res);assert.equal(res.code,200);assert.equal(calls[0]['line_items[0][price_data][unit_amount]'],1000);assert.equal(calls[0]['metadata[username]'],'pro');
 await handler({method:'POST',body:{priceId:'nexus_plus_monthly'}},res);assert.equal(calls[1]['line_items[0][price_data][unit_amount]'],2000);
 await handler({method:'POST',body:{priceId:'price_1UEjoFDh5Di7LYi3DGorrLRb'}},res);assert.equal(calls[2].mode,'payment');assert.equal(calls[2]['metadata[plan]'],undefined);
});
test('Life requires paid access; Calendar and Reminder handlers remain outside usage gates',async()=>{
 let reads=0;const store={overview:async()=>{reads++;return {items:[]};}},res=response();
 await createLifeHandler({getOwner:async()=>null,getUser:async()=> 'free',resolvePlan:async()=> 'free',store})({method:'GET'},res);assert.equal(res.code,402);assert.equal(reads,0);
 await createLifeHandler({getOwner:async()=>null,getUser:async()=> 'pro',resolvePlan:async()=> 'hosted',store})({method:'GET'},res);assert.equal(res.code,200);assert.equal(reads,1);
});

test('paid fulfillment is idempotent, waits for payment, and cannot accept an incorrect pack price',ledgerOptions,async()=>{
 const {meter}=fixture();const session={id:'cs_verified',payment_status:'unpaid',currency:'usd',amount_total:600,metadata:{kind:'credit_pack',username:'pro',credits:'999999'}};
 assert.equal(await fulfillUsagePack(session,meter),false);assert.equal((await meter.summary('pro')).extra.available,false);
 session.payment_status='paid';await fulfillUsagePack(session,meter);await fulfillUsagePack(session,meter);assert.equal((await meter.summary('pro')).extra.percentRemaining,100);
 await assert.rejects(fulfillUsagePack({...session,id:'cs_wrong',amount_total:1},meter),/match the product/);
});
test('paid accounts manage billing rather than accidentally opening a second subscription',async()=>{
 const calls=[],res=response();const handler=createCheckoutHandler({resolveUser:async()=> 'pro',resolvePlan:async()=> 'hosted',resolveCustomer:async()=> 'cus_existing',configured:()=>true,request:async(path,body)=>{calls.push({path,body});return {url:'https://billing.stripe.com/test'};}});
 await handler({method:'POST',body:{priceId:'nexus_plus_monthly'}},res);assert.equal(res.code,200);assert.equal(calls[0].path,'billing_portal/sessions');assert.equal(calls[0].body.customer,'cus_existing');
});

test('measured holds fit remaining capacity, reconcile fractions, and refuse competing calls atomically',ledgerOptions,async()=>{
 const {meter}=fixture();const work={messages:[],maxOutputTokens:4000};const first=await meter.reserveBuild({userId:'free',work});assert.equal(first.maxOutputTokens,2000);assert.equal(first.reserved,2);
 assert.equal((await meter.reserveBuild({userId:'free',work})).ok,false);
 await meter.settleBuild({userId:'free',reservationId:first.reservationId,success:true,chargedCredits:.5,usage:{input:0,output:500,estimated:false}});
 assert.equal((await meter.summary('free')).short.percentRemaining,75);
 const again=await meter.reserveBuild({userId:'free',work});assert.equal(again.maxOutputTokens,1500);assert.equal(again.reserved,1.5);
 await meter.settleBuild({userId:'free',reservationId:again.reservationId,success:false});assert.equal((await meter.summary('free')).short.percentRemaining,75);
});
test('measured work uses paid capacity only after included capacity, keeps pack balance across resets',ledgerOptions,async()=>{
 const {meter,advance}=fixture();await meter.reserveBuild({userId:'free',work:{messages:[],maxOutputTokens:2000}});await meter.grantBonusCredits('free',3,{purchaseId:'cs_measured'});await meter.setExtraEnabled('free',true);
 const hold=await meter.reserveBuild({userId:'free',work:{messages:[],maxOutputTokens:1000}});assert.equal(hold.source,'extra');await meter.settleBuild({userId:'free',reservationId:hold.reservationId,success:true,chargedCredits:.25});assert.equal((await meter.summary('free')).extra.percentRemaining,91);
 advance(8*86400000);assert.equal((await meter.summary('free')).extra.percentRemaining,91);
});
test('a mixed hold consumes included usage first and refunds unused pack capacity',ledgerOptions,async()=>{
 const {meter}=fixture();await meter.reserveBuild({userId:'free'});await meter.grantBonusCredits('free',3,{purchaseId:'cs_mixed'});await meter.setExtraEnabled('free',true);
 const hold=await meter.reserveBuild({userId:'free',work:{messages:[],maxOutputTokens:2000}});assert.equal(hold.source,'mixed');await meter.settleBuild({userId:'free',reservationId:hold.reservationId,success:true,chargedCredits:.5});
 assert.equal((await meter.summary('free')).short.percentRemaining,25);assert.equal((await meter.summary('free')).extra.percentRemaining,100);
});
