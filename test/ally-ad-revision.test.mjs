import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAllyAdReviewQueue,AD_REVIEW_CHUNK_BYTES} from '../lib/allyAdReviewQueue.js';
import {createAllyAdReviewHandler} from '../api/ally-ad-review.js';
import {validateRevisionPlan,revisionFolderId} from '../scripts/ally/qwen-revision-watcher.mjs';

function memory(){
 const s=new Map(),l=new Map();
 return async ([cmd,...a])=>{
  if(cmd==='GET')return s.get(a[0])??null;
  if(cmd==='SET'){if(a.includes('NX')&&s.has(a[0]))return null;s.set(a[0],a[1]);return 'OK';}
  if(cmd==='LPUSH'){const list=l.get(a[0])||[];list.unshift(...a.slice(1));l.set(a[0],list);return list.length;}
  if(cmd==='LRANGE')return (l.get(a[0])||[]).slice(+a[1],+a[2]+1);
  if(cmd==='LTRIM'){l.set(a[0],(l.get(a[0])||[]).slice(+a[1],+a[2]+1));return 'OK';}
  if(cmd==='EXPIRE')return 1;
  if(cmd==='MGET')return a.map(k=>s.get(k)??null);
  if(cmd==='EVAL'){const [,count,key,old,next]=a;assert.equal(count,1);if(s.get(key)!==old)return 0;s.set(key,next);return 1;}
  throw Error('Unexpected mock command: '+cmd);
 };
}
const sha=x=>createHash('sha256').update(x).digest('hex');
function video(letter){const x=Buffer.alloc(140000,letter);x.write('ftyp',4,'ascii');return x;}
async function submit(q,opts={}){
 const owner=opts.owner||'justin',device=opts.device||'ally-A',v=opts.data||video(64);
 const input={project_id:opts.project||'NexusAd-2026',title:'Nexus Qwen sample',bytes:v.length,duration_ms:15000,sha256:sha(v)};
 if(opts.parent){input.revision_of=opts.parent;input.revision_token=opts.token;}
 const b=await q.begin(owner,device,input);
 for(let i=0;i<Math.ceil(v.length/AD_REVIEW_CHUNK_BYTES);i++)await q.part(owner,device,{id:b.id,index:i,data:v.subarray(i*AD_REVIEW_CHUNK_BYTES,(i+1)*AD_REVIEW_CHUNK_BYTES).toString('base64')});
 await q.finish(owner,device,b.id);
 return {id:b.id,input};
}
test('owner feedback becomes a private, paired-device-only revision claim',async()=>{
 const q=createAllyAdReviewQueue({command:memory(),now:()=>100});
 const original=await submit(q);
 await assert.rejects(()=>q.decide('justin',original.id,'rejected','  '),{status:400});
 const decision=await q.decide('justin',original.id,'rejected','Shorten the headline and brighten the CTA');
 assert.equal(decision.status,'rejected');assert.equal(decision.revision_status,'queued');
 assert.equal((await q.claimRevision('justin','ally-B')),null);
 assert.equal((await q.claimRevision('visitor','ally-A')),null);
 const job=await q.claimRevision('justin','ally-A');
 assert.equal(job.review_id,original.id);assert.equal(job.project_id,'NexusAd-2026');
 assert.match(job.token,/^[a-f0-9-]{36}$/);
 assert.equal(job.feedback,'Shorten the headline and brighten the CTA');
 assert.equal((await q.claimRevision('justin','ally-A')),null);
 assert.equal((await q.list('justin'))[0].revision_status,'processing');
 assert.equal(JSON.stringify(await q.list('justin')).includes(job.token),false);
 await assert.rejects(()=>q.renewRevision('justin','ally-B',{id:job.review_id,token:job.token}),{status:409});
 assert.equal((await q.renewRevision('justin','ally-A',{id:job.review_id,token:job.token})).renewed,true);
});
test('revised video links to original and requires a fresh phone approval',async()=>{
 const q=createAllyAdReviewQueue({command:memory(),now:()=>100});
 const parent=(await submit(q)).id;await q.decide('justin',parent,'rejected','Stronger CTA');
 const job=await q.claimRevision('justin','ally-A');
 await assert.rejects(()=>q.begin('justin','ally-A',{project_id:'NexusAd-2026',title:'Original again',bytes:video(64).length,sha256:sha(video(64)),duration_ms:15000,revision_of:parent,revision_token:job.token}),{status:409});
 await assert.rejects(()=>q.begin('justin','ally-B',{project_id:'NexusAd-2026-r1',title:'Wrong device',bytes:video(65).length,sha256:sha(video(65)),duration_ms:15000,revision_of:parent,revision_token:job.token}),{status:409});
 const child=await submit(q,{project:'NexusAd-2026-r1',data:video(65),parent,token:job.token});
 assert.equal((await q.read('justin',child.id)).status,'pending_review');
 await assert.rejects(()=>q.completeRevision('justin','ally-A',{id:parent,token:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',child_id:child.id}),{status:409});
 const updated=await q.completeRevision('justin','ally-A',{id:parent,token:job.token,child_id:child.id});
 assert.equal(updated.revision_status,'ready');assert.equal(updated.revised_review_id,child.id);
 assert.equal((await q.completeRevision('justin','ally-A',{id:parent,token:job.token,child_id:child.id})).revision_status,'ready');
 const row=(await q.list('justin')).find(r=>r.id===child.id);
 assert.equal(row.revision_of,parent);assert.equal(row.revision_generation,1);assert.equal(row.status,'pending_review');
 assert.equal((await q.read('justin',parent)).status,'rejected');
 assert.equal((await q.decide('justin',child.id,'approved')).status,'approved');
});
test('failure stays private and owner can request a retry',async()=>{
 let time=100;const q=createAllyAdReviewQueue({command:memory(),now:()=>time});
 const id=(await submit(q)).id;await q.decide('justin',id,'rejected','Make the message clearer');
 const claim=await q.claimRevision('justin','ally-A');
 await assert.rejects(()=>q.failRevision('justin','ally-B',{id,token:claim.token,message:'wrong'}),{status:409});
 const failed=await q.failRevision('justin','ally-A',{id,token:claim.token,message:'Local render needs attention'});
 assert.equal(failed.revision_status,'needs_help');assert.equal(failed.revision_error,'Local render needs attention');
 assert.equal((await q.claimRevision('justin','ally-A')),null);
 assert.equal((await q.retryRevision('justin',id)).revision_status,'queued');
 const again=await q.claimRevision('justin','ally-A');assert.equal(again.attempt,2);
 time+=31*60*1000;
 const after=await q.claimRevision('justin','ally-A');assert.equal(after.attempt,3);assert.notEqual(after.token,again.token);
 assert.equal(await q.claimRevision('justin','ally-A'),null);
});
test('revision manifest generation accepts only bounded safe copy and palette',()=>{
 const current={headline:'Old headline',offer:'Old offer',cta:'Visit',brand:'Nexus',accent:'#34f5a8',background:'#040b12'};
 assert.deepEqual(validateRevisionPlan('{"headline":"New headline","accent":"#FFAA00"}',current),{headline:'New headline',accent:'#FFAA00'});
 assert.deepEqual(validateRevisionPlan('```json
{"cta":"Get started"}
```',current),{cta:'Get started'});
 for(const invalid of ['{"path":"C:\\\\secret"}','{"headline":"<script>"}','{"accent":"red"}','{"cta":"Visit","shell":"powershell"}','{"headline":"Old headline"}','{not json}']){
  assert.throws(()=>validateRevisionPlan(invalid,current));
 }
 const job={review_id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',project_id:'NexusAd-2026',token:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',feedback:'Shorten text',attempt:1,generation:0};
 assert.match(revisionFolderId(job),/^NexusAd-2026-r1-aaaaaaaa-1$/);
 assert.throws(()=>revisionFolderId({...job,project_id:'../outside'}));
});
function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(v){this.data=v;return this;},end(v){this.body=v;return this;}};}
test('device claim API is authenticated; browser retry requires owner and Origin',async()=>{
 const q=createAllyAdReviewQueue({command:memory()});
 const id=(await submit(q)).id;await q.decide('justin',id,'rejected','Shorter words');
 const handler=createAllyAdReviewHandler({queue:q,
  bridge:{authorizeActiveDevice:async token=>{if(token!=='paired')throw Object.assign(Error('no'),{status:401});return {owner:'justin',device_id:'ally-A'};}},
  resolveAccount:async req=>req.owner?{owner:true,id:'justin'}:{owner:false,id:'visitor'}});
 let res=response();
 await handler({method:'POST',owner:false,headers:{host:'nexus.example','content-type':'application/json',authorization:'Bearer wrong'},body:{action:'revision_claim',input:{}}},res);
 assert.equal(res.code,401);
 res=response();
 await handler({method:'POST',owner:false,headers:{host:'nexus.example','content-type':'application/json',authorization:'Bearer paired'},body:{action:'revision_claim',input:{}}},res);
 assert.equal(res.code,200);assert.equal(res.data.job.review_id,id);
 res=response();
 await handler({method:'POST',owner:true,headers:{host:'nexus.example','content-type':'application/json'},body:{action:'revision_retry',input:{id}}},res);
 assert.equal(res.code,403);
 res=response();
 await handler({method:'POST',owner:true,headers:{host:'nexus.example',origin:'https://attacker.example','content-type':'application/json'},body:{action:'revision_retry',input:{id}}},res);
 assert.equal(res.code,403);
});
