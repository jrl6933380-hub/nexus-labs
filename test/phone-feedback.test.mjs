import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForPhoneFeedback} from '../lib/phoneFeedback.js';
const receipt={command_id:'phone-command',status:'queued',expires_at:45000};
function clock(){let time=0;return {now:()=>time,sleep:async ms=>{time+=ms;}};}
test('one call waits through phone polling and returns the completed image directly',async()=>{
 const c=clock();let reads=0;
 const result=await waitForPhoneFeedback({receipt,...c,timeoutMs:1000,pollMs:250,read:async()=>++reads<3?{status:'delivered'}:{status:'done',ok:true,frame_id:'fresh-frame',inline_images:[{data_base64:'private-image'}]}});
 assert.equal(reads,3);assert.equal(result.waited_ms,500);assert.equal(result.status,'done');assert.equal(result.requires_result_read,false);assert.equal(result.frame_id,'fresh-frame');assert.equal(result.inline_images.length,1);
});
test('bounded timeout preserves the command receipt and never re-enqueues an uncertain action',async()=>{
 const c=clock();let reads=0;const result=await waitForPhoneFeedback({receipt,...c,timeoutMs:1000,pollMs:250,read:async()=>{reads++;return {status:'delivered'};}});
 assert.equal(reads,5);assert.equal(result.waited_ms,1000);assert.equal(result.command_id,receipt.command_id);assert.equal(result.requires_result_read,true);assert.match(result.next,/Do not enqueue/);
});
test('brief result-publication gaps are retried, while expired results stop',async()=>{
 const c=clock();let reads=0;const result=await waitForPhoneFeedback({receipt,...c,timeoutMs:500,pollMs:100,read:async()=>++reads===1?{status:'unavailable'}:{status:'done',ok:true}});
 assert.equal(result.status,'done');assert.equal(reads,2);
 const expired=await waitForPhoneFeedback({receipt,now:()=>46000,read:async()=>({status:'unavailable'})});assert.equal(expired.requires_result_read,false);assert.equal(expired.status,'unavailable');
});
test('stopped session, revoked access and capture failure do not replay an action',async()=>{
 for(const status of [401,403,410]){const r=await waitForPhoneFeedback({receipt,read:async()=>{throw Object.assign(Error('stopped'),{status});}});assert.equal(r.status,'unavailable');assert.equal(r.requires_result_read,false);assert.equal(r.inline_images,undefined);}
 const r=await waitForPhoneFeedback({receipt,read:async()=>({status:'done',ok:true,screen_error:'Protected screen'})});assert.equal(r.ok,true);assert.match(r.next,/do not repeat/);assert.equal(r.requires_result_read,false);
});
test('hung and failed result reads return the original receipt without hanging the tool',async()=>{
 const started=Date.now();const r=await waitForPhoneFeedback({receipt,timeoutMs:20,read:()=>new Promise(()=>{})});assert.equal(r.command_id,receipt.command_id);assert.equal(r.requires_result_read,true);assert.ok(Date.now()-started<1000);
 const error=await waitForPhoneFeedback({receipt,read:async()=>{throw Error('store unavailable');}});assert.equal(error.command_id,receipt.command_id);assert.match(error.next,/do not repeat/);
});
