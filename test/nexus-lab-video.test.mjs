import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNexusLab} from '../lib/nexusLab.js';
import {createNexusLabVideo,validateVideoInput} from '../lib/nexusLabVideo.js';
import {workLabJobOnce} from '../lib/nexusLabWorker.js';
import {LAB_JOB_LIMITS} from '../lib/nexusLabJobs.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
import {labMediaFixture,fixtureOwner as owner,fixtureOther as other,MP4} from '../test-support/labMediaFixture.mjs';
const input={capability:'video',prompt:'A sample landscape.',asset_ids:[],seconds:5,aspect:'landscape'};
const complete={status:'succeeded',video:{bytes:MP4,width:640,height:360,seconds:5},costUsd:0.01};
const provider={verified:true,id:'fixture-video',model:'video-fixture-v1',submit:async()=>({remote_id:'remote-one'}),poll:async()=>complete};
function setup(p=provider){const f=labMediaFixture(),adapter=createNexusLabVideo({assets:f.assets,provider:p}),service=createNexusLab({command:f.command,assets:f.assets,video:adapter,now:f.now});return {...f,adapter,service,enqueue:(data=input,request_id='video-request-one')=>f.jobs.enqueue(owner,{kind:'run',input:data,request_id})};}
const work=f=>workLabJobOnce({owner,store:f.jobs,service:f.service});
test('Video stays disconnected by default and validates bounded settings/references',async()=>{
 const f=setup(null);assert.equal(f.adapter.connection().status,'needs_connection');
 assert.equal((await f.service.overview(owner)).capabilities.find(c=>c.id==='video').status,'needs_connection');
 await assert.rejects(f.adapter.execute(owner,input),{status:409});
 for(const invalid of [{seconds:11},{seconds:0},{aspect:'other'},{provider:'bypass'},{asset_ids:['https://arbitrary.test']}])assert.throws(()=>validateVideoInput({...input,...invalid}));
});
test('submit once, defer polling, resume after restart, save original asset and reopen run',async()=>{
 let submits=0,polls=0;const f=setup({...provider,async submit(args){submits++;assert.ok(args.idempotencyKey.startsWith('lab-'));return {remote_id:'saved-remote'};},async poll({remoteId}){assert.equal(remoteId,'saved-remote');return ++polls===1?{status:'running',retryAfterMs:5000,progress:30}:complete;}});
 const j=await f.enqueue(),waiting=await work(f);assert.equal(waiting.status,'queued');assert.equal(waiting.submission.remote_id,'saved-remote');assert.equal(waiting.attempts,0);
 assert.equal(await work(f),null);f.advance(5001);
 const restarted=createNexusLab({command:f.command,assets:f.assets,video:f.adapter,now:f.now});
 const done=await workLabJobOnce({owner,store:f.jobs,service:restarted});assert.equal(done.status,'succeeded');assert.equal(done.costUsd,0.01);assert.equal(submits,1);
 const run=await restarted.readRun(owner,j.id),asset=await f.assets.read(owner,run.output.asset_id);
 assert.equal(asset.status,'ready');assert.equal(asset.provenance.origin,'generated');assert.equal(run.assets.output[0].media_id,asset.media_id);
 const bytes=Buffer.from((await f.assets.downloadChunk(owner,{media_id:asset.media_id,index:0})).data_base64,'base64');assert.ok(bytes.equals(MP4));
 assert.equal(run.output.sha256,createHash('sha256').update(MP4).digest('hex'));assert.equal(run.output.handoff.media_id,asset.media_id);
 assert.equal((await f.assets.list(owner)).media.length,1);await assert.rejects(restarted.readRun(other,j.id),{status:404});
 assert.equal((await f.enqueue()).id,j.id);assert.equal(await work(f),null);assert.equal(submits,1);
});
test('a known remote job survives lost worker lease without another submission',async()=>{
 let submits=0;const f=setup({...provider,async submit(){submits++;return {remote_id:'unexpected'};}});
 const j=await f.enqueue(),claimed=await f.jobs.claim(owner,'lost');
 await f.jobs.submission(owner,j.id,claimed.lease_token,{provider:provider.id,model:provider.model,remote_id:'already-accepted'});
 f.advance(LAB_JOB_LIMITS.leaseMs+1);
 const done=await work(f);assert.equal(done.status,'succeeded');assert.equal(submits,0);
});
test('an accepted reference video records immutable parent provenance',async()=>{
 const f=setup(),a=await f.upload();await f.enqueue({...input,asset_ids:[a.media_id]});
 const done=await work(f),run=await f.service.readRun(owner,done.id),asset=await f.assets.read(owner,run.output.asset_id);
 assert.equal(asset.provenance.role,'clip');assert.deepEqual(asset.provenance.parent_ids,[a.media_id]);assert.equal(run.assets.input[0].media_id,a.media_id);
});
test('unknown submit outcome never automatically submits or retries again',async()=>{
 let submits=0;const f=setup({...provider,async submit(){submits++;throw Error('private provider credential');}});
 const j=await f.enqueue(),done=await work(f);assert.equal(done.error.code,'SUBMISSION_UNCERTAIN');assert.equal(done.retry_allowed,false);assert.equal(JSON.stringify(done).includes('credential'),false);
 await assert.rejects(f.jobs.retry(owner,j.id),{status:409});assert.equal(await work(f),null);assert.equal(submits,1);
});
test('transient poll failure retries only the saved remote identity',async()=>{
 let submits=0,polls=0;const f=setup({...provider,async submit(){submits++;return {remote_id:'same-remote'};},async poll(){if(++polls===1)throw Error('network');return complete;}});
 await f.enqueue();const queued=await work(f);assert.equal(queued.status,'queued');assert.equal(queued.progress.stage,'Provider poll unavailable');
 f.advance(10001);assert.equal((await work(f)).status,'succeeded');assert.equal(submits,1);
});
test('invalid output cannot be stored as a successful clip',async()=>{
 for(const video of [{...complete.video,bytes:Buffer.alloc(32)},{...complete.video,width:0},{...complete.video,bytes:Buffer.alloc(20*1024*1024+1)}]){
  const f=setup({...provider,poll:async()=>({...complete,video})});await f.enqueue();assert.equal((await work(f)).status,'failed');assert.equal((await f.assets.list(owner)).media.length,0);
 }
});
test('known provider failure is distinguishable and no automatic paid retry is allowed',async()=>{
 const f=setup({...provider,poll:async()=>({status:'failed'})});await f.enqueue();const done=await work(f);
 assert.equal(done.error.code,'PROVIDER_FAILED');assert.equal(done.retry_allowed,false);
});
test('cancellation during poll prevents output writes',async()=>{
 let f,id;f=setup({...provider,async poll(){await f.jobs.cancel(owner,id);return complete;}});
 id=(await f.enqueue()).id;assert.equal((await work(f)).status,'canceled');assert.equal((await f.assets.list(owner)).media.length,0);
});
test('owner API records provider-confirmed cancellation while cross-owner cancellation is denied',async()=>{
 let canceled=0;const f=setup({...provider,poll:async()=>({status:'running'}),async cancel({remoteId}){assert.equal(remoteId,'remote-one');canceled++;return {canceled:true};}});
 const j=await f.enqueue();await work(f);
 const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 const request={method:'POST',headers:{origin:'https://nexus.test',host:'nexus.test','content-type':'application/json'},body:{action:'job_cancel',input:{id:j.id}}};
 const denied=response();await createNexusLabHandler({authenticate:async()=>other,service:f.service,jobs:f.jobs})(request,denied);assert.equal(denied.code,404);assert.equal(canceled,0);
 const r=response();await createNexusLabHandler({authenticate:async()=>owner,service:f.service,jobs:f.jobs})(request,r);
 assert.equal(r.body.job.cancel_scope,'provider_confirmed');assert.equal((await f.jobs.get(owner,j.id)).cancel_scope,'provider_confirmed');assert.equal(canceled,1);
});
test('unsupported remote cancellation remains explicitly local-only',async()=>{
 const f=setup({...provider,poll:async()=>({status:'running'})}),j=await f.enqueue();await work(f);
 const canceled=await f.jobs.cancel(owner,j.id),outcome=await f.adapter.cancel(owner,canceled);assert.equal(outcome.scope,'local_only');
});
test('output upload checkpoint resumes the same asset instead of duplicating it',async()=>{
 const f=setup(),j=await f.enqueue(),claimed=await f.jobs.claim(owner,'crashed');
 await f.jobs.submission(owner,j.id,claimed.lease_token,{provider:provider.id,model:provider.model,remote_id:'accepted'});
 const sha256=createHash('sha256').update(MP4).digest('hex');
 const partial=await f.assets.begin(owner,{name:'partial.mp4',kind:'video',bytes:MP4.length,sha256,width:640,height:360,seconds:5,provenance:{origin:'generated'}});
 await f.jobs.checkpoint(owner,j.id,claimed.lease_token,{output_asset_id:partial.media_id,output_sha256:sha256});
 f.advance(LAB_JOB_LIMITS.leaseMs+1);const done=await work(f);assert.equal(done.status,'succeeded');
 assert.equal((await f.service.readRun(owner,j.id)).output.asset_id,partial.media_id);assert.equal((await f.assets.list(owner)).media.length,1);
});
