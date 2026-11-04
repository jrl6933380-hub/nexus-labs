import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAllyAdReviewQueue,AD_REVIEW_CHUNK_BYTES} from '../lib/allyAdReviewQueue.js';
import {approvedDownloadName,parseSavedReceipt,findVerifiedVideo} from '../scripts/ally/approved-board-watcher.mjs';

function memory(){
 const s=new Map(),lists=new Map();
 return async ([op,...args])=>{
  if(op==='GET')return s.get(args[0])??null;
  if(op==='SET'){if(args.includes('NX')&&s.has(args[0]))return null;s.set(args[0],args[1]);return 'OK';}
  if(op==='LPUSH'){const list=lists.get(args[0])||[];list.unshift(...args.slice(1));lists.set(args[0],list);return list.length;}
  if(op==='LRANGE')return (lists.get(args[0])||[]).slice(+args[1],+args[2]+1);
  if(op==='LTRIM'){lists.set(args[0],(lists.get(args[0])||[]).slice(+args[1],+args[2]+1));return 'OK';}
  if(op==='EXPIRE')return 1;
  if(op==='MGET')return args.map(k=>s.get(k)??null);
  if(op==='EVAL'){const [,count,key,old,next]=args;assert.equal(count,1);if(s.get(key)!==old)return 0;s.set(key,next);return 1;}
  throw Error('Unhandled mock command: '+op);
 };
}
const sha=x=>createHash('sha256').update(x).digest('hex');
async function submit(q,project='QwenApprovedTest',device='ally-A'){
 const body=Buffer.alloc(160000,97);body.write('ftyp',4,'ascii');
 const b=await q.begin('justin',device,{project_id:project,title:'Test ad',bytes:body.length,sha256:sha(body),duration_ms:15000});
 for(let i=0;i<Math.ceil(body.length/AD_REVIEW_CHUNK_BYTES);i++)await q.part('justin',device,{id:b.id,index:i,data:body.subarray(i*AD_REVIEW_CHUNK_BYTES,(i+1)*AD_REVIEW_CHUNK_BYTES).toString('base64')});
 await q.finish('justin',device,b.id);
 return {id:b.id,body};
}
test('only an owner-approved review is queued for the original paired Ally',async()=>{
 const q=createAllyAdReviewQueue({command:memory(),now:()=>100});
 const ad=await submit(q);
 assert.equal(await q.claimBoard('justin','ally-A'),null);
 const ok=await q.decide('justin',ad.id,'approved');
 assert.equal(ok.board_status,'queued');
 assert.equal(await q.claimBoard('justin','ally-B'),null);
 assert.equal(await q.claimBoard('visitor','ally-A'),null);
 const claim=await q.claimBoard('justin','ally-A');
 assert.equal(claim.id,ad.id);assert.equal(claim.sha256,sha(ad.body));
 assert.equal(claim.bytes,ad.body.length);
 assert.match(claim.token,/^[a-f0-9-]{36}$/);
 assert.equal((await q.claimBoard('justin','ally-A')),null);
 const listed=(await q.list('justin'))[0];
 assert.equal(listed.board_status,'processing');
 assert.equal(JSON.stringify(listed).includes(claim.token),false);
 await assert.rejects(()=>q.completeBoard('justin','ally-B',{id:ad.id,token:claim.token,run_id:'a'.repeat(32)}),{status:409});
 await assert.rejects(()=>q.completeBoard('justin','ally-A',{id:ad.id,token:'a'.repeat(36),run_id:'a'.repeat(32)}),{status:409});
 const complete=await q.completeBoard('justin','ally-A',{id:ad.id,token:claim.token,run_id:'b'.repeat(32)});
 assert.equal(complete.board_status,'saved');
 assert.equal(complete.board_run_id,'b'.repeat(32));
 assert.equal((await q.completeBoard('justin','ally-A',{id:ad.id,token:claim.token,run_id:'b'.repeat(32)})).board_status,'saved');
 assert.equal(await q.claimBoard('justin','ally-A'),null);
});
test('uncertain or timed-out uploads are never silently retried',async()=>{
 let clock=100;
 const q=createAllyAdReviewQueue({command:memory(),now:()=>clock});
 const ad=await submit(q);
 await q.decide('justin',ad.id,'approved');
 const claim=await q.claimBoard('justin','ally-A');
 clock+=21*60*1000;
 assert.equal(await q.claimBoard('justin','ally-A'),null);
 const row=(await q.list('justin'))[0];
 assert.equal(row.board_status,'needs_help');
 assert.match(row.board_error,/Inspect the Nexus board/);
 await assert.rejects(()=>q.completeBoard('justin','ally-A',{id:ad.id,token:claim.token,run_id:'c'.repeat(32)}),{status:409});
 const failed=await submit(q,'QwenDifferentAd');
 await q.decide('justin',failed.id,'approved');
 const run=await q.claimBoard('justin','ally-A');
 assert.equal(run.id,failed.id);
 const res=await q.failBoard('justin','ally-A',{id:run.id,token:run.token,message:'Manual macro already in use'});
 assert.equal(res.board_status,'needs_help');
 assert.equal(await q.claimBoard('justin','ally-A'),null);
});
test('previous approvals require a separate owner queue action',async()=>{
 const command=memory(),q=createAllyAdReviewQueue({command,now:()=>100});
 const ad=await submit(q);
 await q.decide('justin',ad.id,'approved');
 const key='nexus:ally-ad-reviews:v1:justin:'+ad.id;
 const row=JSON.parse(await command(['GET',key]));
 delete row.board_status;
 await command(['SET',key,JSON.stringify(row)]);
 assert.equal(await q.claimBoard('justin','ally-A'),null);
 const queued=await q.enqueueBoard('justin',ad.id);
 assert.equal(queued.board_status,'queued');
 assert.equal((await q.enqueueBoard('justin',ad.id)).board_status,'queued');
 assert.equal((await q.claimBoard('justin','ally-A')).id,ad.id);
});
test('saved receipts require macro submission and authoritative board Saved signal',()=>{
 const good={status:'saved',run_id:'e'.repeat(32),submitted:true,message:'Saved status visible'};
 assert.equal(parseSavedReceipt('STEP: save\n'+JSON.stringify(good)+'\n'),good.run_id);
 for(const status of ['needs_help','inspection_passed','already_present'])assert.throws(()=>parseSavedReceipt(JSON.stringify({...good,status})));
 assert.throws(()=>parseSavedReceipt(JSON.stringify({...good,submitted:false})));
 assert.throws(()=>parseSavedReceipt('STEP: save'));
 assert.equal(approvedDownloadName('1'.repeat(32)),'Nexus-Qwen-Approved-'+('1'.repeat(32))+'.mp4');
 assert.throws(()=>approvedDownloadName('../../win'));
});
test('approved video selection requires complete verified render and matching size+SHA',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nexus-board-test-'));
 try{
  const ads=join(root,'NexusAds'),project=join(ads,'QwenTest'),exp=join(project,'exports','2026-11-03');
  await mkdir(exp,{recursive:true});
  const video=Buffer.alloc(1024,91),id='1'.repeat(32),job={id,project_id:'QwenTest',token:'a'.repeat(36),title:'Test Ad',bytes:1024,sha256:sha(video)};
  await writeFile(join(exp,'ad-final.mp4'),video);
  await writeFile(join(exp,'result.json'),JSON.stringify({status:'succeeded',stage:'complete',verified:{h264:true,decoded:true,silent:true}}));
  assert.equal(await findVerifiedVideo(job,ads),join(exp,'ad-final.mp4'));
  await assert.rejects(()=>findVerifiedVideo({...job,sha256:'f'.repeat(64)},ads),/No verified local MP4/);
  await writeFile(join(exp,'result.json'),JSON.stringify({status:'running',stage:'encoding'}));
  await assert.rejects(()=>findVerifiedVideo(job,ads),/No verified local MP4/);
 }finally{await rm(root,{recursive:true,force:true});}
});
