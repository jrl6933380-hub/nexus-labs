import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusLab} from '../lib/nexusLab.js';
import {workLabJobOnce} from '../lib/nexusLabWorker.js';
import {createNexusLabUnderstand,understandOutput,validateUnderstandInput} from '../lib/nexusLabUnderstand.js';
import {readLabMedia} from '../lib/nexusLabMedia.js';
import {labMediaFixture,fixtureOwner as owner,fixtureOther as other,PNG,MP4} from '../test-support/labMediaFixture.mjs';
const input=id=>({capability:'understand',prompt:'Describe this source.',asset_ids:[id]});
const provider={id:'fixture',model:'multimodal-fixture-v1',verified:true,modalities:['image','audio','video'],async analyze({media}){return {summary:'Fixture image.',observations:[{asset_id:media[0].asset_id,text:'A test pixel.'}],costUsd:0};}};
test('Understand defaults disconnected and rejects fake readiness and unsupported fields',async()=>{
 const f=labMediaFixture(),a=await f.upload(),adapter=createNexusLabUnderstand({assets:f.assets});
 assert.equal(adapter.connection().status,'needs_connection');
 await assert.rejects(adapter.execute(owner,input(a.media_id)),{status:409});
 assert.throws(()=>validateUnderstandInput({...input(a.media_id),provider:'override'}));
 assert.throws(()=>validateUnderstandInput({...input(a.media_id),asset_ids:[]}));
 assert.throws(()=>validateUnderstandInput({...input(a.media_id),asset_ids:[a.media_id,a.media_id]}));
 const service=createNexusLab({command:f.command,assets:f.assets,understand:adapter});
 assert.equal((await service.overview(owner)).capabilities.find(c=>c.id==='understand').status,'needs_connection');
});
test('Understand durable job loads verified owner bytes, persists source-linked output and reuses run identity',async()=>{
 const f=labMediaFixture(),asset=await f.upload();let calls=0;
 const adapter=createNexusLabUnderstand({assets:f.assets,provider:{...provider,async analyze(args){calls++;assert.ok(args.media[0].bytes.equals(PNG));assert.ok(args.idempotencyKey.startsWith('lab-'));return provider.analyze(args);}}});
 const service=createNexusLab({command:f.command,assets:f.assets,understand:adapter,now:f.now});
 const j=await f.jobs.enqueue(owner,{kind:'run',input:input(asset.media_id),request_id:'understand-request-one'});
 const done=await workLabJobOnce({owner,store:f.jobs,service,id:j.id});
 assert.equal(done.status,'succeeded');assert.equal(done.provider,'fixture');assert.equal(done.costUsd,0);
 const run=await service.readRun(owner,j.id);
 assert.equal(run.output.observations[0].asset_id,asset.media_id);assert.equal(run.assets.input[0].sha256,asset.sha256);
 assert.equal(JSON.stringify(run).includes('data_base64'),false);assert.equal(run.engine,'multimodal-fixture-v1');
 const again=await f.jobs.enqueue(owner,{kind:'run',input:input(asset.media_id),request_id:'understand-request-one'});
 assert.equal(again.id,j.id);assert.equal(await workLabJobOnce({owner,store:f.jobs,service,id:j.id}),null);assert.equal(calls,1);
 await assert.rejects(service.readRun(other,j.id),{status:404});
});
test('cross-owner media and corrupt bytes fail before a provider call or submission intent',async()=>{
 const f=labMediaFixture(),a=await f.upload();let calls=0;
 const adapter=createNexusLabUnderstand({assets:f.assets,provider:{...provider,analyze:async()=>{calls++;}}});
 const service=createNexusLab({command:f.command,assets:f.assets,understand:adapter});
 const j=await f.jobs.enqueue(other,{kind:'run',input:input(a.media_id),request_id:'understand-other-owner'});
 const done=await workLabJobOnce({owner:other,store:f.jobs,service,id:j.id});assert.equal(done.status,'failed');assert.equal(done.submission,null);assert.equal(calls,0);
 await assert.rejects(readLabMedia(owner,[a.media_id],{assets:{read:f.assets.read,downloadChunk:async()=>({data_base64:Buffer.alloc(PNG.length).toString('base64')})}}),/checksum/);
});
test('provider result rejects invented sources, invalid timestamps and missing source observations',()=>{
 const media=[{asset_id:'med-000001',kind:'video',seconds:10}];
 assert.throws(()=>understandOutput({summary:'x',observations:[{asset_id:'med-unknown',text:'x'}]},media),/unknown asset/);
 assert.throws(()=>understandOutput({summary:'x',observations:[{asset_id:'med-000001',text:'x',start_seconds:9,end_seconds:11}]},media),/timestamp/);
 assert.throws(()=>understandOutput({summary:'x'},media),/source-linked/);
 const valid=understandOutput({summary:'x',transcript:[{asset_id:'med-000001',text:'hello',start_seconds:0,end_seconds:2}]},media);
 assert.equal(valid.transcript[0].end_seconds,2);
});
test('unsupported modality and missing duration fail bounded input validation',async()=>{
 const f=labMediaFixture(),a=await f.upload({bytes:MP4,kind:'video'});
 await assert.rejects(readLabMedia(owner,[a.media_id],{assets:f.assets}),/duration/);
 const b=await f.upload({bytes:MP4,kind:'video',seconds:5});
 await assert.rejects(readLabMedia(owner,[b.media_id],{assets:f.assets,kinds:['image']}),/does not support/);
});
test('provider failure records uncertainty and never permits automatic resubmission',async()=>{
 const f=labMediaFixture(),a=await f.upload();let calls=0;
 const adapter=createNexusLabUnderstand({assets:f.assets,provider:{...provider,async analyze(){calls++;throw Error('credential must not leak');}}});
 const service=createNexusLab({command:f.command,assets:f.assets,understand:adapter});
 const j=await f.jobs.enqueue(owner,{kind:'run',input:input(a.media_id),request_id:'understand-failing-one'});
 const done=await workLabJobOnce({owner,store:f.jobs,service,id:j.id});
 assert.equal(done.error.code,'SUBMISSION_UNCERTAIN');assert.equal(done.retry_allowed,false);assert.equal(JSON.stringify(done).includes('credential'),false);
 await assert.rejects(f.jobs.retry(owner,j.id),{status:409});assert.equal(calls,1);
});
test('cancellation during analysis fences result persistence',async()=>{
 const f=labMediaFixture(),a=await f.upload();let id;
 const adapter=createNexusLabUnderstand({assets:f.assets,provider:{...provider,async analyze(args){await f.jobs.cancel(owner,id);return provider.analyze(args);}}});
 const service=createNexusLab({command:f.command,assets:f.assets,understand:adapter});
 const j=await f.jobs.enqueue(owner,{kind:'run',input:input(a.media_id),request_id:'understand-cancel-one'});id=j.id;
 const done=await workLabJobOnce({owner,store:f.jobs,service,id});
 assert.equal(done.status,'canceled');await assert.rejects(service.readRun(owner,id),{status:404});
});
