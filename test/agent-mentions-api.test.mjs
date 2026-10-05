import test from 'node:test';
import assert from 'node:assert/strict';

// This file must never contact providers or use deployment credentials.
process.env.KV_REST_API_URL='https://kv.invalid';
process.env.KV_REST_API_TOKEN='fixture';
process.env.NEXUS_OWNER_ID='justin';
process.env.SENTRY_DSN='';
const values=new Map(),hashes=new Map(),requests=[];
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://kv.invalid','This test forbids external network calls');
  const [verb,key,...args]=JSON.parse(options.body);requests.push(verb);let result;
  if(verb==='GET')result=values.get(key) || null;
  else if(verb==='SET'){if(args.includes('NX') && values.has(key))result=null;else{values.set(key,args[0]);result='OK';}}
  else if(verb==='HGET')result=hashes.get(key)?.get(args[0]) || null;
  else if(verb==='HSET'){if(!hashes.has(key))hashes.set(key,new Map());hashes.get(key).set(args[0],args[1]);result=1;}
  else if(verb==='HGETALL')result=[...(hashes.get(key) || new Map())].flat();
  else if(verb==='EVAL'){
    const [count,lock,...rest]=args;
    if(Number(count)===1){result=values.get(lock)===rest[0]?1:0;if(result)values.delete(lock);}
    else{const [base,token,value]=rest;result=values.get(lock)===token?1:0;if(result){values.set(base,value);values.delete(lock);}}
  }else throw new Error('Unexpected fixture command: '+verb);
  return {ok:true,json:async()=>({result})};
};
const {createOwnerSession}=await import('../lib/nexusOwnerAuth.js');
const {nexusMessagesStore}=await import('../lib/nexusMessagesStore.js');
const {teamRunStore}=await import('../lib/teamRuns.js');
const {default:handler}=await import('../api/chat.js');
const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});

test('the shared chat API turns typed mentions into owner-scoped saved plans without a provider call',async()=>{
  const researcher=await nexusMessagesStore.createSpecialist('justin',{name:'Maya',role:'research'});
  const token=await createOwnerSession(),headers={cookie:`nexus_owner_session=${token}`};
  const res=response();
  await handler({method:'POST',headers,body:{message:'@maya look this up for me',threadId:'nex-main',requestId:'request-mention-api'}},res);
  assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.teamRun.state,'planned');assert.equal(res.body.usage.output_tokens,0);
  const [saved]=await teamRunStore.list('justin','nex-main');
  assert.deepEqual(saved.steps.map(step=>step.member_id),[researcher.id]);
  assert.equal(saved.state,'planned');assert.equal((await teamRunStore.list('other','nex-main')).length,0);
  const replay=response();await handler({method:'POST',headers,body:{message:'@maya look this up for me',threadId:'nex-main',requestId:'request-mention-api'}},replay);
  assert.equal(replay.body.teamRun.id,saved.id);
  const rejected=response();await handler({method:'POST',headers,body:{message:'@unknown do something',threadId:'agent-missing',workspace:{conversation:{kind:'specialist',id:'agent-missing'}}}},rejected);
  assert.equal(rejected.code,404);
});
