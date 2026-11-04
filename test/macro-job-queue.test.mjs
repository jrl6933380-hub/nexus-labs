import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMacroJobQueue} from '../lib/macroJobQueue.js';
import {createdProject,reviewReceipt,validCopy} from '../scripts/ally/macro-job-watcher.mjs';
function mock(){
 const db=new Map(),lists=new Map();
 return async ([op,...args])=>{
  if(op==='GET')return db.get(args[0])??null;
  if(op==='SET'){if(args.includes('NX')&&db.has(args[0]))return null;db.set(args[0],args[1]);return 'OK';}
  if(op==='LPUSH'){const xs=lists.get(args[0])||[];xs.unshift(...args.slice(1));lists.set(args[0],xs);return xs.length;}
  if(op==='LRANGE')return (lists.get(args[0])||[]).slice(+args[1],+args[2]+1);
  if(op==='LTRIM'){lists.set(args[0],(lists.get(args[0])||[]).slice(+args[1],+args[2]+1));return 'OK';}
  if(op==='EXPIRE')return 1;
  if(op==='MGET')return args.map(k=>db.get(k)??null);
  if(op==='EVAL'){const [,count,key,old,next]=args;assert.equal(count,1);if(db.get(key)!==old)return 0;db.set(key,next);return 1;}
  throw Error('Unknown Redis fixture '+op);
 };
}
const id='abcdef0123456789abcdef0123456789',dev='ally-paired-123',title='Barber Shop';
const fields={request_id:'macro_brief_12345',title,brief:'Make a welcoming 15 second ad about great haircuts and easy appointments.',render_approved:true};
const mocks=()=>({command:mock(),now:()=>1000,uuid:()=> 'a'.repeat(8)+'-'+ 'b'.repeat(4)+'-'+ '4'.repeat(4)+'-'+ '8'.repeat(4)+'-'+ 'c'.repeat(12)});
test('owner must explicitly approve every private render; request IDs are idempotent',async()=>{
 const q=createMacroJobQueue(mocks());
 await assert.rejects(()=>q.create('justin',dev,{...fields,render_approved:false}),{status:400});
 await assert.rejects(()=>q.create('justin','',{...fields}),{status:409});
 const one=await q.create('justin',dev,fields),again=await q.create('justin',dev,fields);
 assert.deepEqual(again,one);
 assert.equal(one.status,'queued');
 assert.equal((await q.list('justin')).length,1);
 assert.equal((await q.list('another-owner')).length,0);
 await assert.rejects(()=>q.create('justin',dev,{...fields,title:'Changed name'}),{status:409});
 assert.ok(!JSON.stringify(one).includes('claim_token'));
});
test('device-only claim, monotonic progress and verified owner review receipt',async()=>{
 const seen=[];
 const q=createMacroJobQueue({...mocks(),reviews:{list:async owner=>{seen.push(owner);return [{id,project_id:'barber-123abc',device_id:dev,status:'pending_review'}];}}});
 const job=await q.create('justin',dev,fields);
 assert.equal(await q.claim('justin','wrong-device'),null);
 const claim=await q.claim('justin',dev);
 assert.equal(claim.id,job.id);
 assert.equal((await q.claim('justin',dev)),null);
 assert.match(claim.token,/^[a-f0-9-]{36}$/);
 const auth={id:claim.id,token:claim.token};
 await assert.rejects(()=>q.heartbeat('justin','wrong-device',{...auth,stage:'writing_copy'}),{status:409});
 assert.deepEqual(await q.heartbeat('justin',dev,{...auth,stage:'writing_copy'}),{cancel_requested:false});
 await q.heartbeat('justin',dev,{...auth,stage:'creating_project'});
 await q.heartbeat('justin',dev,{...auth,stage:'updating_project',project_id:'barber-123abc'});
 await assert.rejects(()=>q.heartbeat('justin',dev,{...auth,stage:'writing_copy'}),{status:409});
 await assert.rejects(()=>q.heartbeat('justin',dev,{...auth,stage:'making_preview',project_id:'other-project'}),{status:409});
 await assert.rejects(()=>q.complete('justin',dev,{...auth,project_id:'barber-123abc',review_id:'f'.repeat(32)}),{status:409});
 await q.heartbeat('justin',dev,{...auth,stage:'sending_for_review'});
 const saved=await q.complete('justin',dev,{...auth,project_id:'barber-123abc',review_id:id});
 assert.equal(saved.status,'awaiting_review');
 assert.equal(saved.review_id,id);assert.deepEqual(seen,['justin','justin']);
 assert.equal(await q.claim('justin',dev),null);
 await assert.rejects(()=>q.heartbeat('justin',dev,{...auth,stage:'sending_for_review'}),{status:409});
});
test('crash with unknown side effects needs manual inspection; no blind retry',async()=>{
 let clock=1000;
 const q=createMacroJobQueue({command:mock(),now:()=>clock,uuid:()=>'11111111-2222-4333-8444-555555555555'});
 const a=await q.create('justin',dev,fields),claim=await q.claim('justin',dev);
 await q.heartbeat('justin',dev,{id:a.id,token:claim.token,stage:'rendering_video',project_id:'barber-123abc'});
 clock+=31*60*1000;
 assert.equal(await q.claim('justin',dev),null);
 const row=(await q.list('justin'))[0];assert.equal(row.status,'needs_help');
 assert.match(row.error,/Inspect local project/);
 await assert.rejects(()=>q.heartbeat('justin',dev,{id:a.id,token:claim.token,stage:'sending_for_review'}),{status:409});
 await assert.rejects(()=>q.cancel('justin',a.id),{status:409});
});
test('cancel queued or request safe stop of already-processing render',async()=>{
 const q=createMacroJobQueue(mocks());
 const a=await q.create('justin',dev,fields);
 assert.equal((await q.cancel('justin',a.id)).status,'canceled');
 assert.equal(await q.claim('justin',dev),null);
 const other=await q.create('justin',dev,{...fields,request_id:'other_request_id_123'});
 const claim=await q.claim('justin',dev);
 const cancel=await q.cancel('justin',other.id);
 assert.equal(cancel.cancel_requested,true);
 assert.deepEqual(await q.heartbeat('justin',dev,{id:other.id,token:claim.token,stage:'writing_copy'}),{cancel_requested:true});
 const failed=await q.fail('justin',dev,{id:other.id,token:claim.token,message:'Stop requested'});
 assert.equal(failed.status,'canceled');
});
test('worker only accepts strict data-only ad copy and genuine macro receipts',()=>{
 const copy={brand:'Lopez Cuts',headline:'Fresh cuts. Easy booking.',offer:'A welcoming neighborhood barber shop.',cta:'Book a visit'};
 assert.deepEqual(validCopy(JSON.stringify(copy)),copy);
 for(const bad of [JSON.stringify({...copy,command:'whoami'}),JSON.stringify({...copy,headline:'<script>alert(1)</script>'}),'not json'])
  assert.throws(()=>validCopy(bad));
 const docs='C:\\Users\\owner\\Documents';
 assert.equal(createdProject('CREATED C:\\Users\\owner\\Documents\\NexusAds\\barber-abcdef\\project.json\r\n',docs),'barber-abcdef');
 assert.throws(()=>createdProject('CREATED C:\\Users\\owner\\Downloads\\barber\\project.json',docs));
 assert.equal(reviewReceipt('NEXUS_REVIEW_SUBMITTED '+id+'\r\n'),id);
 assert.equal(reviewReceipt('NEXUS_REVIEW_EXISTS '+id+' pending_review\r\n'),id);
 assert.throws(()=>reviewReceipt('UPLOAD OK'));
});
