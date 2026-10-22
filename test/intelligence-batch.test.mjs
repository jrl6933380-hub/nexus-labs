import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runIntelligenceBatch,validateIntelligenceInput,observedAmounts} from '../lib/intelligenceBatch.js';
import {runActor} from '../actors/intelligence/runtime.js';

const snapshot=(text='Starter\n$39 per month',url='https://public.com/pricing')=>({url,text,title:'Plans',capturedAt:'2026-10-22T12:00:00.000Z',hash:createHash('sha256').update(text).digest('hex')});
test('deduplicates URLs and bounds selected work before capture',async()=>{
  const outputs=[];let calls=0;
  const summary=await runIntelligenceBatch({urls:['https://public.com/pricing','https://public.com/pricing#same','https://another.com'],maxPages:1},{capture:async()=>{calls++;return snapshot();},publish:async row=>outputs.push(row)});
  assert.equal(calls,1);assert.equal(outputs.length,1);assert.equal(summary.unique,2);assert.equal(summary.skipped,1);
});
test('validates whole input before producing a paid result',async()=>{
  let calls=0;await assert.rejects(runIntelligenceBatch({urls:['https://public.com','http://127.0.0.1']},{capture:async()=>calls++}));assert.equal(calls,0);
  assert.throws(()=>validateIntelligenceInput({urls:['https://public.com'],maxPages:51}));
  assert.throws(()=>validateIntelligenceInput({urls:['https://public.com'],includeText:'false'}));
});
test('emits source-backed change excerpts and marks one successful-result event',async()=>{
  let row,event;const previous={...snapshot('Starter\n$29 per month'),status:'captured',contentHash:'caller-hash-is-not-trusted'};
  const result=await runIntelligenceBatch({urls:['https://public.com/pricing'],previousResults:[previous]},{capture:async()=>snapshot(),publish:async(r,e)=>{row=r;event=e;}});
  assert.equal(result.successful,1);assert.equal(event.chargeEvent,'page-result');assert.equal(row.comparison,'changed');assert.deepEqual(row.removed,['$29 per month']);assert.deepEqual(row.added,['$39 per month']);assert.deepEqual(row.observedAmounts,['$39']);assert.equal(row.screenshotUrl,null);
});
test('failed captures are visible without a charge event or fabricated baseline',async()=>{
  let output,event;const summary=await runIntelligenceBatch({urls:['https://public.com']},{capture:async()=>{throw Object.assign(Error('Access challenge'),{code:'BROWSER_REQUIRED'});},publish:async(r,e)=>{output=r;event=e;}});
  assert.equal(event.chargeEvent,null);assert.equal(summary.failed,1);assert.equal(summary.successful,0);assert.equal(output.comparison,'unavailable');assert.equal(output.capturedAt,null);
});
test('budget stops network work before the next page and explicit omitted output stops batch',async()=>{
  let calls=0,budget=1;const summary=await runIntelligenceBatch({urls:['https://a.com','https://b.com']},{canPublish:async()=>budget>0,capture:async()=>{calls++;return snapshot();},publish:async()=>{budget--;}});
  assert.equal(calls,1);assert.equal(summary.stoppedForBudget,true);assert.equal(summary.emitted,1);
  const stopped=await runIntelligenceBatch({urls:['https://a.com']},{capture:async()=>snapshot(),publish:async()=>({emitted:false})});assert.equal(stopped.successful,0);assert.equal(stopped.stoppedForBudget,true);
});
test('dataset or billing failures propagate instead of being hidden as capture failures',async()=>{
  let pushes=0;await assert.rejects(runIntelligenceBatch({urls:['https://public.com']},{capture:async()=>snapshot(),publish:async()=>{pushes++;throw Error('Storage unavailable');}}),/Storage unavailable/);assert.equal(pushes,1);
});
test('baselines match original URL after redirects and unchanged captures stay explicit',async()=>{
  const old={...snapshot(),status:'captured',requestedUrl:'https://public.com/start'};let output;
  await runIntelligenceBatch({urls:['https://public.com/start'],previousResults:[old],includeText:false},{capture:async()=>snapshot(),publish:async row=>output=row});
  assert.equal(output.comparison,'unchanged');assert.equal('text' in output,false);assert.deepEqual(output.added,[]);
});
test('rejects incomplete or duplicate earlier results instead of silently making false diffs',()=>{
  assert.throws(()=>validateIntelligenceInput({urls:['https://public.com'],previousResults:[{status:'failed'}]}));
  const baseline={...snapshot(),status:'captured'};
  assert.throws(()=>validateIntelligenceInput({urls:['https://public.com'],previousResults:[baseline,baseline]}));
  assert.deepEqual(observedAmounts('USD 49; $29; £100; $29'),['USD 49','$29','£100']);
});
test('Actor adapter routes successful events and uncharged failures through the SDK',async()=>{
  const rows=[],saved=new Map(),messages=[];let calls=0;
  const actor={getInput:async()=>({urls:['https://public.com','https://other.com']}),getChargingManager:()=>({calculateMaxEventChargeCountWithinLimit:()=>10}),pushData:async(...args)=>rows.push(args),setValue:async(k,v)=>saved.set(k,v),setStatusMessage:async s=>messages.push(s)};
  const summary=await runActor(actor,{capture:async()=>{if(calls++)throw Object.assign(Error('blocked'),{code:'BROWSER_REQUIRED'});return snapshot();}});
  assert.equal(rows[0][1],'page-result');assert.equal(rows[1].length,1);assert.equal(saved.get('SUMMARY'),summary);assert.equal(summary.failed,1);assert.match(messages.at(-1),/1 captures, 1 inspection gaps/);
});
