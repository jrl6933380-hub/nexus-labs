import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KV_REST_API_URL='https://example.invalid';process.env.KV_REST_API_TOKEN='test';
const hashes=new Map(),original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  const [cmd,key,...args]=JSON.parse(options.body);let result=null;
  if(cmd==='EVAL'){
    const [count,realKey,...values]=args,hash=hashes.get(realKey) || new Map();
    if(key.includes("redis.call('HSET'")){const [id,expected,value]=values;result=hash.get(id)===expected?1:0;if(result)hash.set(id,value);}
    else{result=0;for(let i=0;i<values.length;i+=2)if(hash.get(values[i])!==values[i+1])result=-1;if(result!==-1)for(let i=0;i<values.length;i+=2)result+=Number(hash.delete(values[i]));}
  }else{
    const hash=hashes.get(key) || new Map();hashes.set(key,hash);
    if(cmd==='HSET'){hash.set(args[0],args[1]);result=1;}
    if(cmd==='HGET')result=hash.get(args[0]) || null;
    if(cmd==='HGETALL')result=[...hash].flat();
  }
  return {ok:true,json:async()=>({result})};
};
const {clearConversationMessages,clearConversationThreads,saveConversationThread,loadConversationThread,threadsKeyFor}=await import('../lib/nexConversationStore.js');
test.after(()=>{globalThis.fetch=original;});
const noop=async()=>0;
const make=(id)=>saveConversationThread('justin',{id,messages:[{role:'user',content:'My ongoing project is a local landscaping business.'}]});
test('individual agent chat is cleared after key details are saved, keeping its record',async()=>{
  await make('agent-core-atlas');let reviewed=false;
  const result=await clearConversationMessages('justin','agent-core-atlas',{preserve:async threads=>{reviewed=true;assert.equal(threads[0].messages.length,1);return {saved:1};},purge:noop});
  assert.ok(reviewed);assert.equal(result.memoriesSaved,1);assert.equal((await loadConversationThread('justin','agent-core-atlas')).messages.length,0);
});
test('review failure leaves the conversation intact',async()=>{
  await make('t-failure');await assert.rejects(clearConversationMessages('justin','t-failure',{preserve:async()=>{throw Error('offline');},purge:noop}),/offline/);
  assert.equal((await loadConversationThread('justin','t-failure')).messages.length,1);
});
test('cleanup refuses to erase messages that arrived during memory review',async()=>{
  await make('t-changing');await assert.rejects(clearConversationMessages('justin','t-changing',{purge:noop,preserve:async()=>{await saveConversationThread('justin',{id:'t-changing',messages:[{role:'user',content:'A new message arrived.'}]});return {saved:0};}}),/changed/);
  assert.equal((await loadConversationThread('justin','t-changing')).messages[0].content,'A new message arrived.');
});
test('bulk cleanup reviews only selected recent chats and keeps agents and chosen chats',async()=>{
  hashes.delete(threadsKeyFor('justin'));await make('t-clear');await make('t-keep');await make('agent-core-vida');
  const result=await clearConversationThreads('justin',['t-keep'],{purge:noop,preserve:async threads=>{assert.deepEqual(threads.map(x=>x.id),['t-clear']);return {saved:0};}});
  assert.equal(result.deleted,1);assert.equal(result.memoriesSaved,0);assert.equal(await loadConversationThread('justin','t-clear'),null);assert.ok(await loadConversationThread('justin','t-keep'));assert.ok(await loadConversationThread('justin','agent-core-vida'));
});
