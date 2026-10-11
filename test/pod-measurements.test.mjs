import test from 'node:test';
import assert from 'node:assert/strict';
import {beginPodMeasurement,loadPodMeasurements,summarizePodMeasurements} from '../lib/podMeasurements.js';
const env={KV_REST_API_URL:'https://example.invalid',KV_REST_API_TOKEN:'secret'};
test('pod measurements retain numeric counters, first-token time and duration once, without prompts',async()=>{
  let time=100;const commands=[];
  const measurement=beginPodMeasurement({env,kind:'fresh',now:()=>time,command:async value=>commands.push(value)});
  time=140;measurement.bodyReady();time=1100;
  await measurement.finish({usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:300},completion_tokens_details:{reasoning_tokens:80},prompt:'private'},firstDeltaDelayMs:60,prompt:'private',username:'private'});
  await measurement.finish({success:false});
  assert.equal(commands.length,1);assert.equal(commands[0][0],'EVAL');
  const record=JSON.parse(commands[0][4]);
  assert.equal(record.durationMs,1000);assert.equal(record.firstTokenMs,100);
  assert.deepEqual(record.usage,{input:1000,output:200,cached:300,reasoning:80,estimated:false});
  assert.doesNotMatch(JSON.stringify(commands),/private|secret/);
});
test('missing counters and failures do not create guessed calibration tokens',async()=>{
  const records=[];
  const options={env,command:async command=>records.push(JSON.parse(command[4]))};
  await beginPodMeasurement(options).finish({success:true});
  await beginPodMeasurement(options).finish({success:false,usage:{prompt_tokens:500,completion_tokens:30}});
  const summary=summarizePodMeasurements(records);
  assert.equal(summary.successful,1);assert.equal(summary.failed,1);
  assert.equal(summary.reportedUsageSamples,0);assert.equal(summary.missingUsageSamples,1);
  assert.equal(summary.totals.output,0);assert.equal(summary.firstTokenMs.p50,null);
});
test('recent summary survives malformed rows and distinguishes latency from throughput',async()=>{
  const result=await loadPodMeasurements({env,command:async()=>['broken',JSON.stringify({at:1,durationMs:1000,success:true,firstTokenMs:100,usage:{input:100,output:20,cached:0,reasoning:5,estimated:false}}),JSON.stringify({at:2,durationMs:2000,success:true,firstTokenMs:null,usage:{input:100,output:40,cached:0,reasoning:10,estimated:false}})]});
  assert.equal(result.sampleCount,2);assert.equal(result.latencyMs.p95,2000);
  assert.equal(result.firstTokenMs.p50,100);assert.equal(result.outputTokensPerRequestSecondP50,20);
  assert.equal(result.totals.output,60);assert.equal(result.totals.reasoning,15);
});
test('measurement storage outages do not break inference and unconfigured storage makes no request',async()=>{
  await beginPodMeasurement({env,command:async()=>{throw new Error('offline');}}).finish({success:true});
  await beginPodMeasurement({env:{},command:async()=>assert.fail('storage must not be called')}).finish();
  const summary=await loadPodMeasurements({env:{},command:async()=>assert.fail('storage must not be called')});
  assert.equal(summary.configured,false);assert.equal(summary.sampleCount,0);
});

test('a real owner router call records raw pod counters without billing or leaking its prompt',async()=>{
  const {routeMessage}=await import('../lib/modelRouter.js');
  const {_resetPodCacheForTests}=await import('../lib/forge/podBrain.js');
  _resetPodCacheForTests();
  const original=global.fetch,stored=[];
  global.fetch=async(url,options)=>{
    assert.equal(url,env.KV_REST_API_URL);
    stored.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({result:1})};
  };
  const reply=data=>({ok:true,json:async()=>data});
  try {
    const result=await routeMessage({preferPod:true,env:{...env,RUNPOD_API_KEY:'rp',NEX_POD_KEY:'pk',NEX_QWEN_ONLY:'true'},body:{messages:[{role:'user',content:'private test prompt'}]},fetchFn:async url=>{
      if(url.endsWith('/pods'))return reply([{id:'pod-1',name:'nex-pod',desiredStatus:'RUNNING'}]);
      if(url.endsWith('/models'))return reply({});
      assert.ok(url.endsWith('/chat/completions'));
      return reply({choices:[{message:{content:'private response'}}],usage:{prompt_tokens:123,completion_tokens:45,completion_tokens_details:{reasoning_tokens:20}}});
    }});
    assert.equal(result.provider,'nex-pod');assert.equal(stored.length,1);
    const record=JSON.parse(stored[0][4]);assert.equal(record.kind,'owner');assert.equal(record.usage.reasoning,20);
    assert.doesNotMatch(JSON.stringify(stored),/private test prompt|private response/);
  } finally {global.fetch=original;_resetPodCacheForTests();}
});
