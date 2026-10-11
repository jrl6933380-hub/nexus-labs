import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeModelUsage,aiWorkAmount,estimatedInputTokens} from '../lib/aiWorkUsage.js';
import {reserveModelCall} from '../lib/forge/meterGate.js';
import {continuedStream} from '../lib/forge/brainStream.js';
test('reported output includes reasoning once and cache hits reduce input work',()=>{
 const usage=normalizeModelUsage({prompt_tokens:4000,completion_tokens:2000,prompt_tokens_details:{cached_tokens:3000},completion_tokens_details:{reasoning_tokens:1500}});
 assert.equal(usage.reasoning,1500);assert.equal(usage.output,2000);assert.equal(aiWorkAmount(usage),2.4);assert.equal(usage.estimated,false);
 assert.equal(aiWorkAmount(normalizeModelUsage({prompt_tokens:4000,completion_tokens:2000})),3);
});
test('missing runtime counters are marked estimated; text and images reserve context',()=>{
 assert.equal(normalizeModelUsage(null,{input:400,output:100}).estimated,true);assert.equal(aiWorkAmount(normalizeModelUsage(null,{input:400,output:100})),.2);
 assert.ok(estimatedInputTokens([{content:'hello'}])>5);assert.ok(estimatedInputTokens([{content:[{type:'image_url'}]}])>=4096);
});
test('measured reservation forwards its output ceiling and reconciles actual work once',async()=>{
 const calls=[];const meter={reserveBuild:async args=>{calls.push(args);return {ok:true,reservationId:'hold',maxOutputTokens:500};},settleBuild:async args=>calls.push(args)};
 const hold=await reserveModelCall({username:'customer',work:{messages:[{content:'hello'}],maxOutputTokens:2000},meter,isOperator:()=>false});assert.equal(hold.maxOutputTokens,500);
 await hold.settle({usage:{prompt_tokens:100,completion_tokens:200,completion_tokens_details:{reasoning_tokens:150}}});await hold.settle({success:false});assert.equal(calls.length,2);assert.equal(calls[1].chargedCredits,.225);assert.equal(calls[1].usage.reasoning,150);
});
function stream(text,finish,usage){const frames=[{choices:[{delta:{content:text,reasoning_content:'thinking'},finish_reason:null}]},{choices:[{delta:{},finish_reason:finish}]},{choices:[],usage}];return new ReadableStream({start(c){for(const frame of frames)c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));c.close();}});}
test('stream captures final usage for every continuation and awaits persistent settlement',async()=>{
 const rounds=[],order=[];const body=continuedStream(stream('<html>','length',{prompt_tokens:100,completion_tokens:200}),{baseMessages:[],maxRounds:2,openRound:async()=>{order.push('next');return {body:stream('</html>','stop',{prompt_tokens:300,completion_tokens:400})};},onRoundFinished:async result=>{await Promise.resolve();rounds.push(result);order.push('settled');}});
 for await(const chunk of body){}assert.equal(rounds.length,2);assert.deepEqual(order,['settled','next','settled']);assert.equal(rounds[0].usage.completion_tokens,200);assert.equal(rounds[1].usage.prompt_tokens,300);
});
test('unresponsive retry refunds failed round rather than charging duplicate inference',async()=>{
 let calls=0;const stalled=new ReadableStream({start(){}});const rounds=[];const body=continuedStream(stalled,{baseMessages:[],stallTimeoutMs:5,maxStallRetries:1,openStallRetry:async()=>({body:stream('<html></html>','stop',{prompt_tokens:30,completion_tokens:50})}),onRoundFinished:result=>rounds.push(result)});for await(const chunk of body){}assert.equal(rounds[0].success,false);assert.equal(rounds[1].success,true);
});
test('closing a streamed task cancels inference and awaits its persisted settlement',async()=>{
 let cancelled=false,settled=false;const upstream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));},cancel(){cancelled=true;}});
 const body=continuedStream(upstream,{baseMessages:[],onFinished:async({success})=>{await Promise.resolve();assert.equal(success,true);settled=true;}});const reader=body.getReader();await reader.read();await reader.cancel('customer closed');assert.equal(cancelled,true);assert.equal(settled,true);
});
