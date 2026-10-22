import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runIntelligenceBatch,validateIntelligenceInput,observedAmounts,captureWithRetry,storedBaseline} from '../lib/intelligenceBatch.js';
import {runActor,baselineKey} from '../actors/intelligence/runtime.js';

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
  const kv=new Map(),actor={openKeyValueStore:async()=>({getValue:async k=>kv.get(k),setValue:async(k,v)=>kv.set(k,v)}),getInput:async()=>({urls:['https://public.com','https://other.com']}),getChargingManager:()=>({calculateMaxEventChargeCountWithinLimit:()=>10}),pushData:async(...args)=>rows.push(args),setValue:async(k,v)=>saved.set(k,v),setStatusMessage:async s=>messages.push(s)};
  const summary=await runActor(actor,{capture:async()=>{if(calls++)throw Object.assign(Error('blocked'),{code:'BROWSER_REQUIRED'});return snapshot();}});
  assert.equal(rows[0][1],'page-result');assert.equal(rows[1].length,1);assert.equal(saved.get('SUMMARY'),summary);assert.equal(summary.failed,1);assert.match(messages.at(-1),/1 captures \(0 changed\), 1 inspection gaps/);
});

const fakeActor=(input,kv=new Map(),rows=[])=>({openKeyValueStore:async name=>{kv.name=name;return{getValue:async k=>kv.get(k),setValue:async(k,v)=>kv.set(k,v)};},getInput:async()=>input,
  getChargingManager:()=>({calculateMaxEventChargeCountWithinLimit:()=>10}),pushData:async(...a)=>rows.push(a),setValue:async()=>{},setStatusMessage:async()=>{}});
test('saved baselines make the second run a real comparison with no pasted results',async()=>{
  const kv=new Map(),rows=[];const input={urls:['https://public.com/pricing']};
  await runActor(fakeActor(input,kv,rows),{capture:async()=>snapshot('Starter\n$29 per month')});
  assert.equal(rows[0][0].comparison,'baseline');assert.equal(kv.name,'nexus-intelligence-baselines');
  const summary=await runActor(fakeActor(input,kv,rows),{capture:async()=>snapshot('Starter\n$39 per month')});
  assert.equal(rows[1][0].comparison,'changed');assert.deepEqual(rows[1][0].removed,['$29 per month']);
  assert.equal(summary.changed,1);assert.equal(summary.storedBaselinesUsed,1);assert.deepEqual(summary.changedUrls,['https://public.com/pricing']);
  const third=await runActor(fakeActor(input,kv,rows),{capture:async()=>snapshot('Starter\n$39 per month')});
  assert.equal(rows[2][0].comparison,'unchanged');assert.equal(third.unchanged,1);
});
test('failed captures never overwrite the saved baseline',async()=>{
  const kv=new Map(),rows=[];const input={urls:['https://public.com/pricing']};
  await runActor(fakeActor(input,kv,rows),{capture:async()=>snapshot('Starter\n$29 per month')});
  const before=JSON.stringify([...kv.entries()]);
  await runActor(fakeActor(input,kv,rows),{capture:async()=>{throw Object.assign(Error('blocked'),{code:'BROWSER_REQUIRED'});}});
  assert.equal(JSON.stringify([...kv.entries()]),before);assert.equal(rows[1][0].status,'failed');assert.ok(rows[1][0].previousCapturedAt);
});
test('rememberBaselines false is stateless and never opens storage',async()=>{
  let opened=false;const actor={...fakeActor({urls:['https://public.com'],rememberBaselines:false}),openKeyValueStore:async()=>{opened=true;}};
  await runActor(actor,{capture:async()=>snapshot()});assert.equal(opened,false);
});
test('explicit previousResults override the saved baseline',async()=>{
  const kv=new Map([[baselineKey('https://public.com/pricing'),{text:'old saved',capturedAt:'2026-10-01T00:00:00.000Z',title:'t',url:'https://public.com/pricing'}]]);
  const rows=[];const prev={...snapshot('Starter\n$19 per month'),status:'captured'};
  await runActor(fakeActor({urls:['https://public.com/pricing'],previousResults:[prev]},kv,rows),{capture:async()=>snapshot()});
  assert.deepEqual(rows[0][0].removed,['$19 per month']);
});
test('malformed saved baselines are ignored, not trusted',()=>{
  assert.equal(storedBaseline(null),null);assert.equal(storedBaseline({text:'',capturedAt:'2026-10-01T00:00:00.000Z'}),null);
  assert.equal(storedBaseline({text:'x',capturedAt:'not a date'}),null);assert.equal(storedBaseline({text:'x'.repeat(24001),capturedAt:'2026-10-01T00:00:00.000Z'}),null);
  assert.equal(storedBaseline({text:'a',capturedAt:'2026-10-01T00:00:00.000Z',hash:'forged'}).hash,createHash('sha256').update('a').digest('hex'));
});
test('transient failures retry once; permanent ones do not',async()=>{
  let calls=0;const sleeps=[];
  assert.equal(await captureWithRetry(async()=>{if(calls++===0)throw Object.assign(Error('t'),{code:'TIMEOUT'});return 'ok';},'u',async ms=>sleeps.push(ms)),'ok');assert.equal(calls,2);assert.equal(sleeps.length,1);
  calls=0;await assert.rejects(captureWithRetry(async()=>{calls++;throw Object.assign(Error('Page returned HTTP 404.'),{code:'HTTP_ERROR'});},'u',async()=>{}));assert.equal(calls,1);
  calls=0;await assert.rejects(captureWithRetry(async()=>{calls++;throw Object.assign(Error('Page returned HTTP 503.'),{code:'HTTP_ERROR'});},'u',async()=>{}));assert.equal(calls,2);
  calls=0;await assert.rejects(captureWithRetry(async()=>{calls++;throw Object.assign(Error('x'),{code:'BROWSER_REQUIRED'});},'u',async()=>{}));assert.equal(calls,1);
});
test('rejects bad baseline store names before any work',()=>{
  for(const name of ['A','ab','Has_Upper','-lead','trail-','a'.repeat(64),5])assert.throws(()=>validateIntelligenceInput({urls:['https://public.com'],baselineStoreName:name}));
  assert.throws(()=>validateIntelligenceInput({urls:['https://public.com'],rememberBaselines:'yes'}));
});
