// Owner-scoped durable, device-bound ad factory queue.
// A one-time explicit private-render grant is required for every new job.
// All side effects are performed by a paired Ally; Redis stores intent and receipts.
import {createHash,randomUUID} from 'node:crypto';
import {teamCommand} from './teamRuns.js';
import {allyAdReviewQueue} from './allyAdReviewQueue.js';

const TTL=60*60*24*30;
const LEASE_MS=30*60*1000;
const MAX_QUEUE=40;
const MAX_ACTIVE=8;
const CAS="if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1";
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,32);
const base=o=>'nexus:macro-jobs:v1:'+encodeURIComponent(o);
const key=(o,id)=>base(o)+':'+id;
const index=o=>base(o)+':index';
const idOK=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const deviceOK=x=>typeof x==='string'&&x.length>5&&x.length<=120;
const tokenOK=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
const projectOK=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(x);
const titleOK=x=>typeof x==='string'&&x.trim()&&x.length<=72&&/^[\p{L}\p{N} _-]+$/u.test(x);
const briefOK=x=>typeof x==='string'&&x.trim().length>=12&&x.length<=800&&!/[\u0000-\u0008\u000e-\u001f<>]/.test(x);
const requestOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(x);
const STAGES=['claimed','writing_copy','creating_project','updating_project','making_preview','rendering_video','sending_for_review'];
const publicJob=record=>record&&({id:record.id,title:record.title,brief:record.brief,status:record.status,
 stage:record.stage,created_at:record.created_at,updated_at:record.updated_at,project_id:record.project_id||null,
 review_id:record.review_id||null,error:record.error||'',cancel_requested:!!record.cancel_requested});
async function cas(command,o,old,next){
 return Number(await command(['EVAL',CAS,1,key(o,old.id),JSON.stringify(old),JSON.stringify(next)]))===1;
}
export function createMacroJobQueue({command=teamCommand,reviews=allyAdReviewQueue,now=Date.now,uuid=randomUUID}={}){
 async function read(owner,id){
  if(!idOK(id))throw bad('Invalid job.',400);
  const value=await command(['GET',key(owner,id)]);
  if(!value)throw bad('Job not found.',404);
  return JSON.parse(value);
 }
 async function list(owner){
  const ids=await command(['LRANGE',index(owner),'0',String(MAX_QUEUE-1)])||[];
  if(!ids.length)return [];
  const raws=await command(['MGET',...ids.map(id=>key(owner,id))])||[];
  return raws.filter(Boolean).map(x=>publicJob(JSON.parse(x)));
 }
 async function create(owner,device,{request_id,title,brief,render_approved}={}){
  if(!deviceOK(device))throw bad('Pair your Ally to Nexus before sending jobs.',409);
  if(!requestOK(request_id)||!titleOK(title)||!briefOK(brief)||render_approved!==true)
   throw bad('Enter an ad name and brief, then approve the private render.',400);
  const id=digest(owner+'\n'+request_id),existing=await command(['GET',key(owner,id)]);
  if(existing){
   const old=JSON.parse(existing);
   if(old.request_id!==request_id||old.title!==title.trim()||old.brief!==brief.trim()||old.device_id!==device)
    throw bad('This submit ID was already used for a different job.',409);
   return publicJob(old);
  }
  const current=await list(owner);
  if(current.filter(x=>['queued','processing'].includes(x.status)).length>=MAX_ACTIVE)throw bad('Your Ally queue is full. Complete a job before adding another.',409);
  const record={id,request_id,title:title.trim(),brief:brief.trim(),device_id:device,status:'queued',
   stage:'waiting_for_ally',render_approved:true,created_at:now(),updated_at:now(),project_id:null,review_id:null,
   error:'',token:null,lease_until:0,cancel_requested:false};
  if(await command(['SET',key(owner,id),JSON.stringify(record),'NX','EX',String(TTL)])==='OK'){
   await command(['LPUSH',index(owner),id]);
   await command(['LTRIM',index(owner),'0',String(MAX_QUEUE-1)]);
   await command(['EXPIRE',index(owner),String(TTL)]);
   return publicJob(record);
  }
  const winner=await read(owner,id);
  if(winner.request_id!==request_id||winner.title!==title.trim()||winner.brief!==brief.trim()||winner.device_id!==device)
   throw bad('This submit ID belongs to a different ad.',409);
  return publicJob(winner);
 }
 async function cancel(owner,id){
  const old=await read(owner,id);
  if(['awaiting_review','canceled'].includes(old.status))return publicJob(old);
  if(old.status==='needs_help')throw bad('An uncertain job needs inspection before any changes.',409);
  if(old.status==='queued'){
   const next={...old,status:'canceled',stage:'canceled',updated_at:now()};
   if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
   return publicJob(next);
  }
  if(old.status==='processing'){
   const next={...old,cancel_requested:true,updated_at:now()};
   if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
   return publicJob(next);
  }
  throw bad('This job cannot be canceled.',409);
 }
 async function claim(owner,device){
  const ids=await command(['LRANGE',index(owner),'0',String(MAX_QUEUE-1)])||[];
  const raws=ids.length?await command(['MGET',...ids.map(id=>key(owner,id))])||[]:[];
  const records=raws.filter(Boolean).map(x=>JSON.parse(x));
  // Do not run two macro chains at once on this owner’s Ally.
  for(const r of records){
   if(r.device_id!==device||r.status!=='processing')continue;
   if(r.lease_until>now())return null;
   const failed={...r,status:'needs_help',stage:'interrupted',error:'Ally stopped during a macro. Inspect local project and review queue before retrying.',
    token:null,lease_until:0,updated_at:now()};
   if(!await cas(command,owner,r,failed))return null; // A concurrent heartbeat may have renewed it.
  }
  for(const r of [...records].reverse()){
   if(r.device_id!==device||r.status!=='queued'||r.render_approved!==true)continue;
   const next={...r,status:'processing',stage:'claimed',token:uuid(),lease_until:now()+LEASE_MS,updated_at:now()};
   if(!await cas(command,owner,r,next))continue;
   return {id:r.id,title:r.title,brief:r.brief,token:next.token};
  }
  return null;
 }
 async function authorized(owner,device,{id,token}={}){
  if(!idOK(id)||!tokenOK(token))throw bad('Invalid claim.',403);
  const r=await read(owner,id);
  if(r.device_id!==device||r.token!==token||r.status!=='processing'||r.lease_until<=now())
   throw bad('Claim is no longer active.',409);
  return r;
 }
 async function heartbeat(owner,device,{id,token,stage,project_id}={}){
  const old=await authorized(owner,device,{id,token});
  if(!STAGES.includes(stage))throw bad('Unrecognized job stage.',400);
  if(STAGES.indexOf(stage)<STAGES.indexOf(old.stage) && old.stage!=='claimed')throw bad('Job stage cannot go backward.',409);
  if(project_id!==undefined&&!projectOK(project_id))throw bad('Invalid ad project ID.',400);
  if(old.project_id&&project_id&&project_id!==old.project_id)throw bad('Project cannot be replaced.',409);
  const next={...old,stage,project_id:project_id||old.project_id,updated_at:now(),lease_until:now()+LEASE_MS};
  if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
  return {cancel_requested:!!next.cancel_requested};
 }
 async function complete(owner,device,{id,token,project_id,review_id}={}){
  const old=await authorized(owner,device,{id,token});
  if(!projectOK(project_id)||!idOK(review_id)||!old.project_id||old.project_id!==project_id)
   throw bad('Unverified job completion.',409);
  if(old.cancel_requested)throw bad('Stop requested. Do not mark completed.',409);
  // Cross-check real owner-only review, device and project; a fake "uploaded" string is insufficient.
  const list=await reviews.list(owner);
  const review=list.find(x=>x.id===review_id);
  if(!review||review.project_id!==project_id||review.device_id!==device||
    !['pending_review','approved','rejected'].includes(review.status))
   throw bad('Verified private review not found for this job.',409);
  const next={...old,status:'awaiting_review',stage:'waiting_for_owner',review_id,token:null,lease_until:0,updated_at:now()};
  if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
  return publicJob(next);
 }
 async function fail(owner,device,{id,token,message}={}){
  const old=await authorized(owner,device,{id,token});
  if(typeof message!=='string'||message.length>180)throw bad('Failure message too long.',400);
  const next={...old,status:old.cancel_requested?'canceled':'needs_help',
   stage:old.cancel_requested?'canceled':'needs_attention',error:message.replace(/[\u0000-\u001f]/g,' ').slice(0,180),
   token:null,lease_until:0,updated_at:now()};
  if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
  return publicJob(next);
 }
 return {read,list,create,cancel,claim,heartbeat,complete,fail};
}
export const macroJobQueue=createMacroJobQueue();
