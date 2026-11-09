import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createForgeLeadJobQueue,normalizeSpec,validateResult} from '../lib/forgeLeadJobs.js';
import {validJob,batchDir,searchResult,previewReceipt,packResult} from '../scripts/ally/forge-lead-watcher.mjs';
import {createForgeLeadJobsHandler} from '../api/forge-lead-jobs.js';

function fakeRedis(){
 const kv=new Map(),lists=new Map();
 return async args=>{
  const [op,k,...rest]=args;
  if(op==='GET')return kv.get(k)??null;
  if(op==='SET'){if(rest.includes('NX')&&kv.has(k))return null;kv.set(k,rest[0]);return 'OK';}
  if(op==='LPUSH'){const l=lists.get(k)||[];l.unshift(rest[0]);lists.set(k,l);return l.length;}
  if(op==='LTRIM'||op==='EXPIRE')return 1;
  if(op==='LRANGE')return lists.get(k)||[];
  if(op==='MGET')return [k,...rest].map(x=>kv.get(x)??null);
  if(op==='EVAL'){const key=rest[1],old=rest[2],next=rest[3];if(kv.get(key)!==old)return 0;kv.set(key,next);return 1;}
  throw Error('unsupported '+op);
 };
}
const OWNER='owner-1',DEVICE='device-abcdef';
const BATCH='batch-11111111-2222-3333-4444-555555555555';
function queue(){let t=1000,n=0;return createForgeLeadJobQueue({command:fakeRedis(),now:()=>(t+=10),uuid:()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0')});}
const searchInput={request_id:'req-search-001',kind:'search',business:'barbers',city:'Des Moines, Iowa',count:10};
const leads=[{name:'North End Barbershop',status:'social_booking_only',duplicate:false,phone:'(515) 555-0101',notes:'Social only.'},
 {name:'Big Chain',status:'has_website',notes:''}];

test('spec rules: plain text only, 1-10 results, picks by number or eligible',()=>{
 assert.deepEqual(normalizeSpec({kind:'build',picks:[3,1,3],offer:true}),{kind:'build',picks:[1,3],offer:true});
 assert.equal(normalizeSpec({kind:'build',picks:'eligible'}).picks,'eligible');
 for(const bad of [{kind:'search',business:'<b>x</b>',city:'Ames',count:5},{kind:'search',business:'barbers',city:'Ames',count:11},
  {kind:'search',business:'a',city:'Ames',count:5},{kind:'build',picks:[]},{kind:'build',picks:[11]},{kind:'nope'}])
  assert.throws(()=>normalizeSpec(bad));
});

test('search job: create is idempotent, only the paired device claims, result is validated and stored',async()=>{
 const q=queue();
 const job=await q.create(OWNER,DEVICE,searchInput);
 assert.equal(job.status,'queued');
 assert.equal((await q.create(OWNER,DEVICE,searchInput)).id,job.id);
 await assert.rejects(()=>q.create(OWNER,DEVICE,{...searchInput,city:'Ames'}),/different job/);
 assert.equal(await q.claim(OWNER,'other-device-1'),null);
 const claimed=await q.claim(OWNER,DEVICE);
 assert.equal(claimed.kind,'search');assert.equal(claimed.business,'barbers');
 assert.equal(await q.claim(OWNER,DEVICE),null,'one job at a time per Ally');
 await assert.rejects(()=>q.complete(OWNER,DEVICE,{id:job.id,token:'11111111-1111-4111-8111-111111111111',result:{batch:BATCH,leads}}),/Claim is no longer active/);
 await assert.rejects(()=>q.heartbeat(OWNER,DEVICE,{id:claimed.id,token:claimed.token,stage:'bogus'}),/stage/);
 await q.heartbeat(OWNER,DEVICE,{id:claimed.id,token:claimed.token,stage:'searching'});
 await assert.rejects(()=>q.complete(OWNER,DEVICE,{id:claimed.id,token:claimed.token,result:{batch:'../x',leads}}),/Invalid result/);
 const done=await q.complete(OWNER,DEVICE,{id:claimed.id,token:claimed.token,result:{batch:BATCH,leads}});
 assert.equal(done.status,'done');
 const result=await q.getResult(OWNER,job.id);
 assert.equal(result.leads[0].n,1);assert.equal(result.leads[1].n,2);
 await assert.rejects(()=>q.getResult('someone-else',job.id),/not found/);
});

test('build job needs a finished search on this Ally and valid pick numbers; result must match the batch',async()=>{
 const q=queue();
 const s=await q.create(OWNER,DEVICE,searchInput);
 await assert.rejects(()=>q.create(OWNER,DEVICE,{request_id:'req-build-0001',kind:'build',source_id:s.id,picks:[1]}),/not finished/);
 const c=await q.claim(OWNER,DEVICE);
 await q.complete(OWNER,DEVICE,{id:c.id,token:c.token,result:{batch:BATCH,leads}});
 await assert.rejects(()=>q.create(OWNER,DEVICE,{request_id:'req-build-0002',kind:'build',source_id:s.id,picks:[5]}),/Pick numbers/);
 await assert.rejects(()=>q.create(OWNER,'device-other-1',{request_id:'req-build-0003',kind:'build',source_id:s.id,picks:[1]}),/not finished/);
 const b=await q.create(OWNER,DEVICE,{request_id:'req-build-0004',kind:'build',source_id:s.id,picks:'eligible',offer:true});
 const bc=await q.claim(OWNER,DEVICE);
 assert.equal(bc.kind,'build');assert.equal(bc.batch,BATCH);assert.equal(bc.offer,true);
 await assert.rejects(()=>q.complete(OWNER,DEVICE,{id:bc.id,token:bc.token,result:{batch:'batch-99999999-0000-0000-0000-000000000000',packs:[]}}),/different batch/);
 const big='x'.repeat(70001);
 await q.complete(OWNER,DEVICE,{id:bc.id,token:bc.token,result:{batch:BATCH,packs:[{name:'North End',pitch:'PITCH',previews:{editorial:'<h1>a</h1>',bold:big,evil:'<script>'}}]}});
 const r=await q.getResult(OWNER,b.id);
 assert.deepEqual(Object.keys(r.packs[0].previews),['editorial']);
});

test('cancel: queued jobs stop at once, running jobs are asked to stop, failures are recorded',async()=>{
 const q=queue();
 const a=await q.create(OWNER,DEVICE,searchInput);
 assert.equal((await q.cancel(OWNER,a.id)).status,'canceled');
 const b=await q.create(OWNER,DEVICE,{...searchInput,request_id:'req-search-002'});
 const c=await q.claim(OWNER,DEVICE);
 assert.equal((await q.cancel(OWNER,b.id)).cancel_requested,true);
 assert.equal((await q.heartbeat(OWNER,DEVICE,{id:c.id,token:c.token,stage:'searching'})).cancel_requested,true);
 await assert.rejects(()=>q.complete(OWNER,DEVICE,{id:c.id,token:c.token,result:{batch:BATCH,leads}}),/Stop requested/);
 assert.equal((await q.fail(OWNER,DEVICE,{id:c.id,token:c.token,message:'stopped'})).status,'canceled');
});

test('validateResult never lets markup into names or notes',()=>{
 const r=validateResult('search',{batch:BATCH,leads:[{name:'A <img src=x>',status:'needs_checking',notes:'<script>',phone:'1'}]});
 assert.doesNotMatch(JSON.stringify(r),/[<>]/);
});

test('API: owner-only create, device-only claim, cross-site refused',async()=>{
 const q=queue();
 const owner={owner:true,id:OWNER};
 const bridge={status:async()=>({paired:true,device_id:DEVICE}),authorizeActiveDevice:async t=>{if(t!=='dev-token')throw Object.assign(new Error('no'),{status:401});return {owner:OWNER,device_id:DEVICE};}};
 const handler=createForgeLeadJobsHandler({queue:q,bridge,resolveAccount:async req=>req.headers.cookie==='owner'?owner:null});
 const call=async(req)=>{let out={};const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){out.status=c;return this;},json(b){out.body=b;return this;}};
  await handler({method:'POST',headers:{host:'x.test',origin:'https://x.test','content-type':'application/json'},...req},res);return out;};
 assert.equal((await call({body:{action:'create',input:searchInput}})).status,403);
 const made=await call({headers:{host:'x.test',origin:'https://x.test','content-type':'application/json',cookie:'owner'},body:{action:'create',input:searchInput}});
 assert.equal(made.status,200);
 assert.equal((await call({headers:{host:'x.test','sec-fetch-site':'cross-site','content-type':'application/json',cookie:'owner'},body:{action:'create',input:searchInput}})).status,403);
 assert.equal((await call({body:{action:'device_claim',input:{}}})).status,401);
 const claim=await call({headers:{host:'x.test','content-type':'application/json',authorization:'Bearer dev-token'},body:{action:'device_claim',input:{}}});
 assert.equal(claim.body.job.kind,'search');
});

test('Ally watcher only accepts well-formed jobs and local folders',async()=>{
 const id='a'.repeat(32),token='00000000-0000-4000-8000-000000000001';
 assert.ok(validJob({id,token,kind:'search',business:'barbers',city:'Ames, Iowa',count:5}));
 assert.ok(validJob({id,token,kind:'build',batch:BATCH,picks:[1,2],offer:false}));
 assert.ok(!validJob({id,token,kind:'search',business:'barbers; calc',city:'Ames',count:5}));
 assert.ok(!validJob({id,token,kind:'build',batch:'..\\evil',picks:'eligible',offer:false}));
 assert.ok(!validJob({id,token,kind:'shell',command:'dir'}));
 const root='C:\\x\\batches';
 assert.throws(()=>batchDir('BATCH C:\\elsewhere\\batch-11111111-2222-3333-4444-555555555555',root),/Unexpected/);
 assert.throws(()=>searchResult(BATCH,{status:'needs_attention',error:'Google needs verification'}),/verification/);
 assert.equal(searchResult(BATCH,{status:'ready_for_review',candidates:[{name:'A',status:'needs_checking'}]}).leads.length,1);
 assert.throws(()=>previewReceipt('nothing','C:\\x\\previews'),/receipt missing/);
});

test('packResult reads pitch and three previews from a preview folder',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lead-pack-'));
 try{
  await mkdir(join(dir,'01-north-end'));
  await writeFile(join(dir,'pack.json'),JSON.stringify({leads:[{name:'North End',folder:'01-north-end'}]}));
  await writeFile(join(dir,'01-north-end','pitch.txt'),'PITCH');
  for(const k of ['editorial','bold','fresh'])await writeFile(join(dir,'01-north-end',k+'.html'),'<h1>'+k+'</h1>');
  const r=await packResult(BATCH,dir);
  assert.equal(r.packs[0].pitch,'PITCH');assert.deepEqual(Object.keys(r.packs[0].previews),['editorial','bold','fresh']);
  await writeFile(join(dir,'pack.json'),JSON.stringify({leads:[{name:'x',folder:'..\\..'}]}));
  await assert.rejects(()=>packResult(BATCH,dir),/Unexpected lead folder/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
