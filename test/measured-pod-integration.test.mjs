import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
process.env.NEX_QWEN_ONLY='true';process.env.KV_REST_API_URL='https://meter-test.invalid';process.env.KV_REST_API_TOKEN='test';process.env.RUNPOD_API_KEY='test';process.env.NEX_POD_KEY='test';
let store={},requests=[],mode='chat',round=0;
global.fetch=async(url,options={})=>{
 if(url===process.env.KV_REST_API_URL){const command=JSON.parse(options.body);if(command[0]==='HGET')return {ok:true,json:async()=>({result:JSON.stringify({plan:'hosted'})})};const result=spawnSync('python',['test/helpers/usage-lua.py'],{input:JSON.stringify({command,store}),encoding:'utf8'});assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);store=data.store;return {ok:true,json:async()=>({result:data.result})};}
 if(url.endsWith('/pods'))return {ok:true,json:async()=>[{id:'test',name:'nex-pod',desiredStatus:'RUNNING'}]};if(url.endsWith('/models'))return {ok:true};
 assert.ok(url.endsWith('/chat/completions'));const request=JSON.parse(options.body);requests.push(request);
 if(mode==='chat')return {ok:true,json:async()=>({choices:[{message:{content:'Hello'}}],usage:{prompt_tokens:100,completion_tokens:200,completion_tokens_details:{reasoning_tokens:150}}})};
 round++;const first=round===1,frames=[{choices:[{delta:{content:first?'<html>':'</html>'},finish_reason:first?'length':'stop'}]},{choices:[],usage:{prompt_tokens:first?100:300,completion_tokens:first?200:400}}];return {ok:true,body:new ReadableStream({start(c){for(const frame of frames)c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));c.close();}})};
};
const {askCustomerBrain,openBuildStream}=await import('../lib/forge/brainStream.js');
function state(){return JSON.parse(store['nexus:usage:v2:customer']);}
test('real Qwen chat path reserves before inference and persists actual reasoning-inclusive usage',async()=>{
 const result=await askCustomerBrain({username:'customer',body:{messages:[{role:'user',content:'Hello'}],max_tokens:900}});assert.equal(result.text,'Hello');assert.equal(state().short.spent,.225);const hold=Object.values(state().holds)[0];assert.equal(hold.usage.reasoning,150);assert.equal(hold.usage.estimated,false);assert.equal(hold.settled,true);assert.equal(requests[0].max_tokens,1800);
});
test('real Qwen build path meters and settles every continuation round',async()=>{
 mode='build';const result=await openBuildStream({username:'customer',body:{messages:[{role:'user',content:'Build a page'}],max_tokens:1000}});for await(const chunk of result.response.body){}assert.equal(round,2);assert.ok(requests.slice(1).every(request=>request.stream_options.include_usage));assert.ok(Math.abs(state().short.spent-.925)<1e-8);assert.equal(Object.values(state().holds).filter(h=>h.settled).length,3);
});
