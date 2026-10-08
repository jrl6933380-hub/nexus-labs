import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusControlsStore,replyPreference} from '../lib/nexusControls.js';
import {createNexusControlsHandler} from '../api/nexus-controls.js';
function fixture(){
  const hashes=new Map(),calls=[];let clock=Date.parse('2026-10-08T07:00:00Z');
  const run=async parts=>{
    calls.push(parts);const [command,key,...args]=parts;
    if(command==='HGETALL')return Object.entries(hashes.get(key)||{}).flat();
    if(command==='HSET'){const value=hashes.get(key)||{};for(let i=0;i<args.length;i+=2)value[args[i]]=args[i+1];hashes.set(key,value);return 1;}
    if(command==='EVAL'){
      assert.match(key,/HINCRBY/u);assert.match(key,/EXPIRE/u);
      const hashKey=parts[3],value=hashes.get(hashKey)||{};
      for(const [name,amount] of [['turns',1],['input',parts[4]],['output',parts[5]],['reported',parts[6]],['elapsed',parts[7]]])value[name]=String(Number(value[name]||0)+Number(amount));
      hashes.set(hashKey,value);return 1;
    }
    throw new Error('Unexpected command');
  };
  return {store:createNexusControlsStore({run,now:()=>clock}),calls,setClock:value=>{clock=value;}};
}
test('controls persist isolated owner preferences and reject fabricated settings',async()=>{
  const {store}=fixture();assert.equal((await store.preferences('justin')).accent,'gold');
  await store.save('justin',{accent:'blue',responseStyle:'concise'});
  assert.equal((await store.preferences('justin')).responseStyle,'concise');assert.equal((await store.preferences('another')).accent,'gold');
  assert.match(replyPreference(await store.preferences('justin')),/concise/u);
  await assert.rejects(store.save('justin',{exempt:true}),/valid account controls/u);
  await assert.rejects(store.save('justin',{accent:'red'}),/valid account controls/u);
});
test('usage aggregates concurrent turns independently of chats and rolls over UTC days',async()=>{
  const {store,setClock}=fixture();
  await Promise.all(Array.from({length:12},()=>store.record('justin',{input_tokens:100,output_tokens:25},2000)));
  let summary=await store.usage('justin');assert.equal(summary.days[0].turns,12);assert.equal(summary.days[0].input,1200);assert.equal(summary.days[0].output,300);
  assert.equal((await store.usage('another')).days[0].turns,0);
  setClock(Date.parse('2026-10-09T00:00:00Z'));
  await store.record('justin',undefined,100);
  summary=await store.usage('justin');assert.equal(summary.days[0].turns,1);assert.equal(summary.days[0].reported,0);assert.equal(summary.days[1].turns,12);assert.equal(summary.days.length,7);
});
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('controls API requires the private owner and never accepts client owner or plan overrides',async()=>{
  const {store}=fixture(),res=response();
  await createNexusControlsHandler({getOwner:async()=>null,store})({method:'GET'},res);assert.equal(res.code,401);
  const handler=createNexusControlsHandler({getOwner:async()=>({id:'justin'}),store});
  await handler({method:'POST',body:{owner:'another',plan:'unlimited'}},res);assert.equal(res.code,400);
  await handler({method:'POST',body:{accent:'green'}},res);assert.equal(res.code,200);
  await handler({method:'GET'},res);assert.equal(res.body.account.id,'justin');assert.equal(res.body.preferences.accent,'green');assert.equal(res.body.account.exempt,true);
});
test('storage failures do not become fake saved settings or zero usage',async()=>{
  const store=createNexusControlsStore({run:async()=>{throw new Error('offline');}}),res=response();
  const handler=createNexusControlsHandler({getOwner:async()=>({id:'justin'}),store});
  await handler({method:'GET'},res);assert.equal(res.code,503);assert.equal(res.body.usage,undefined);
  await handler({method:'POST',body:{accent:'blue'}},res);assert.equal(res.code,503);
});
