import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusLab,forecast} from '../lib/nexusLab.js';

const owner={id:'justin'};
function memory(){const lists=new Map();return async([op,key,...args])=>{if(op==='LRANGE')return (lists.get(key)||[]).slice(Number(args[0]),Number(args[1])+1);if(op==='LPUSH'){lists.set(key,[args[0],...(lists.get(key)||[])]);return lists.get(key).length;}if(op==='LTRIM'){lists.set(key,(lists.get(key)||[]).slice(Number(args[0]),Number(args[1])+1));return 'OK';}throw Error(op);};}

test('Predict finds a repeating pattern and uses it', () => {
  const r=forecast([10,20,10,20,10,20,10,20,10,20,10,20,10,20,10,20]);
  assert.equal(r.chosen,'seasonal');assert.equal(Math.round(r.next),10);
  assert.equal(r.seasonality.period,2);
});

test('Predict keeps the plain trend when it is already right', () => {
  const r=forecast([2,4,6,8,10,12,14,16]);
  assert.equal(r.chosen,'trend');assert.equal(r.next,18);assert.equal(r.seasonality,null);
});

test('Predict warns about a spike, a flat series and a short history', () => {
  const spike=forecast([5,6,5,7,6,8,7,9,40,9,8,10,9,11]);
  assert.ok(spike.flags.some(f=>f.code==='outliers'));assert.equal(spike.confidence,'low');
  const flat=forecast([5,5,5,5,5,5,5]);
  assert.ok(flat.flags.some(f=>f.code==='flat'));assert.ok(flat.flags.some(f=>f.code==='short_history'));assert.equal(flat.next,5);
});

test('Predict gives a range around the estimate and still rejects bad input', () => {
  const r=forecast([100,90,120,60,130,50,140,40]);
  assert.ok(r.range.low<r.next&&r.next<r.range.high);
  for(const bad of [null,'1,2,3',[1,2],[1,2,3,4,5,NaN],[1,2,3,4,5,'6'],Array(201).fill(1),[1e13,1,2,3,4,5]])assert.throws(()=>forecast(bad));
});

test('Predict stays the same on repeat (no randomness)', () => {
  const v=[3,1,4,1,5,9,2,6,5,3,5,8];
  assert.deepEqual(forecast(v),forecast(v));
});

test('Search runs and understands synonyms without hiding exact matches', async () => {
  const store=memory();
  const lab=createNexusLab({command:store,catalog:async()=>[
    {id:'1',name:'Shoe launch kit',text:'Sneaker ad templates'},
    {id:'2',name:'Invoice helper',text:'Billing and tax reminders'},
    {id:'3',name:'Calm voiceover',text:'Serene narration'},
  ],env:{}});
  const found=await lab.run(owner,{capability:'search',query:'footwear'});
  assert.equal(found.engine,'token-coverage-dictionary-v1');
  assert.equal(found.output.results[0].name,'Shoe launch kit');
  const calm=await lab.run(owner,{capability:'search',query:'peaceful'});
  assert.equal(calm.output.results[0].name,'Calm voiceover');
  const none=await lab.run(owner,{capability:'search',query:'zebra'});
  assert.equal(none.output.results.length,0);
});

test('Search hides weak dictionary-only hits when most of the brief is unmatched', async () => {
  const lab=createNexusLab({command:memory(),catalog:async()=>[{id:'1',name:'Life insurance',text:'explainer for families'}],env:{}});
  const r=await lab.run(owner,{capability:'search',query:'quiet luxury skiing living home'});
  assert.equal(r.output.results.length,0);
});
