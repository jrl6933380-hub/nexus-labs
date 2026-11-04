import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMacroJobsHandler} from '../api/macro-jobs.js';
const req=(method,body,headers={})=>({
 method,body,headers:{host:'nexus-labs-sigma.vercel.app',origin:'https://nexus-labs-sigma.vercel.app',
  'content-type':'application/json',...headers}
});
const respond=()=>{
 const out={code:200,headers:{}};
 out.setHeader=(k,v)=>{out.headers[k]=v;return out;};
 out.status=n=>{out.code=n;return out;};
 out.json=b=>{out.body=b;return out;};
 return out;
};
function handler(owner=true){
 const calls=[];
 const queue={
  list:async id=>{calls.push('list:'+id);return [];},
  create:async(owner,device,input)=>{calls.push('create:'+owner+':'+device);return {id:'1'.repeat(32),title:input.title};},
  cancel:async(owner,id)=>{calls.push('cancel:'+owner+':'+id);return {id,status:'canceled'};},
  claim:async(owner,dev)=>{calls.push('claim:'+owner+':'+dev);return null;},
  heartbeat:async()=>({cancel_requested:false}),
  complete:async()=>({status:'awaiting_review'}),
  fail:async()=>({status:'needs_help'})
 };
 const bridge={status:async id=>({paired:true,device_id:'ally-1234'}),authorizeActiveDevice:async token=>{
  if(token!=='correct-token')throw Object.assign(Error('Denied'),{status:401});
  return {owner:'justin',device_id:'ally-1234'};
 }};
 const h=createMacroJobsHandler({queue,bridge,resolveAccount:async()=>({id:'justin',owner})});
 return {h,calls};
}
test('owner required to list/create; origin gate blocks cross-site and non-UI submissions',async()=>{
 const x=handler(false),y=handler();
 let res=respond();await x.h(req('GET'),res);assert.equal(res.code,403);
 res=respond();await x.h(req('POST',{action:'create',input:{title:'Ad'}}),res);assert.equal(res.code,403);
 res=respond();await y.h(req('POST',{action:'create',input:{}},{origin:'https://attacker.example'}),res);assert.equal(res.code,403);
 res=respond();await y.h(req('POST',{action:'create',input:{}},{origin:undefined}),res);assert.equal(res.code,403);
 assert.deepEqual(x.calls,[]);
 res=respond();await y.h(req('GET'),res);assert.equal(res.code,200);assert.equal(res.body.jobs.length,0);
 assert.deepEqual(y.calls,['list:justin']);
});
test('owner request enqueues only onto already paired device; no general shell endpoint',async()=>{
 const y=handler(),res=respond();
 await y.h(req('POST',{action:'create',input:{title:'Barber',brief:'A welcoming salon',request_id:'unique1234',render_approved:true}}),res);
 assert.equal(res.code,200);assert.equal(res.body.job.title,'Barber');
 assert.deepEqual(y.calls,['create:justin:ally-1234']);
 const command=respond();await y.h(req('POST',{action:'terminal',input:{command:'whoami'}}),command);assert.equal(command.code,400);
});
test('device credentials are validated for claim and not accepted as an owner session',async()=>{
 const y=handler(false);
 const no=respond();await y.h(req('POST',{action:'device_claim',input:{}},{origin:undefined,authorization:'Bearer bad'}),no);assert.equal(no.code,401);
 const yes=respond();await y.h(req('POST',{action:'device_claim',input:{}},{origin:undefined,authorization:'Bearer correct-token'}),yes);
 assert.equal(yes.code,200);assert.deepEqual(y.calls,['claim:justin:ally-1234']);
 assert.deepEqual(yes.body,{job:null});
});
