// Owner-scoped, device-bound queue for Forge lead jobs (search, then build previews + pitch).
// Only the owner can create/cancel/read results. Only the actively paired Ally can claim and finish.
// Nothing here sends, calls, posts or publishes. Results are text and sandboxable HTML only.
import {createHash,randomUUID} from 'node:crypto';
import {teamCommand} from './teamRuns.js';

const TTL=60*60*24*30,LEASE_MS=30*60*1000,MAX_QUEUE=40,MAX_ACTIVE=4,MAX_RESULT=900000,MAX_HTML=70000;
const CAS="if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') return 1";
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,32);
const base=o=>'nexus:forge-lead-jobs:v1:'+encodeURIComponent(o);
const key=(o,id)=>base(o)+':'+id;
const resultKey=(o,id)=>base(o)+':result:'+id;
const index=o=>base(o)+':index';
const idOK=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const deviceOK=x=>typeof x==='string'&&x.length>5&&x.length<=120;
const tokenOK=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
const requestOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(x);
const textOK=(x,max)=>typeof x==='string'&&x.trim().length>=2&&x.trim().length<=max&&/^[\p{L}\p{N} .,'&-]+$/u.test(x.trim());
const clean=(x,max)=>String(x??'').replace(/[\u0000-\u001f<>]/g,' ').trim().slice(0,max);
const BATCH=/^batch-[0-9a-f-]{8,64}$/;
const SITE=['no_dedicated_site_found','social_booking_only','has_website','needs_checking'];
const STAGES=['claimed','searching','building','uploading'];

export function normalizeSpec(input={}){
 if(input.kind==='search'){
  const count=Number(input.count??10);
  if(!textOK(input.business,80)||!textOK(input.city,100)||!Number.isInteger(count)||count<1||count>10)
   throw bad('Enter a business type, a city and 1-10 results.');
  return {kind:'search',business:input.business.trim().replace(/\s+/g,' '),city:input.city.trim().replace(/\s+/g,' '),count};
 }
 if(input.kind==='build'){
  let picks=input.picks;
  if(picks!=='eligible'){
   if(!Array.isArray(picks)||!picks.length||picks.length>10||picks.some(n=>!Number.isInteger(n)||n<1||n>10))
    throw bad('Pick 1-10 leads by number, or choose all eligible.');
   picks=[...new Set(picks)].sort((a,b)=>a-b);
  }
  return {kind:'build',picks,offer:input.offer===true};
 }
 throw bad('Unsupported job type.');
}
const publicJob=r=>r&&({id:r.id,kind:r.kind,spec:r.spec,status:r.status,stage:r.stage,created_at:r.created_at,
 updated_at:r.updated_at,error:r.error||'',cancel_requested:!!r.cancel_requested,has_result:!!r.has_result});

export function validateResult(kind,r){
 if(!r||typeof r!=='object'||Array.isArray(r)||!BATCH.test(r.batch||''))throw bad('Invalid result.',400);
 let out;
 if(kind==='search'){
  if(!Array.isArray(r.leads)||r.leads.length>10)throw bad('Invalid result list.',400);
  out={batch:r.batch,leads:r.leads.map((l,i)=>{
   if(!l||!SITE.includes(l.status))throw bad('Invalid lead status.',400);
   return {n:i+1,name:clean(l.name,120),status:l.status,duplicate:l.duplicate===true,phone:clean(l.phone,30),notes:clean(l.notes,240)};
  })};
 }else{
  if(!Array.isArray(r.packs)||r.packs.length>10)throw bad('Invalid pack list.',400);
  out={batch:r.batch,packs:r.packs.map(p=>{
   if(!p||typeof p.pitch!=='string')throw bad('Invalid pack.',400);
   const previews={};
   for(const k of ['editorial','bold','fresh'])if(typeof p.previews?.[k]==='string'&&p.previews[k].length<=MAX_HTML)previews[k]=p.previews[k];
   return {name:clean(p.name,120),pitch:p.pitch.slice(0,8000),previews};
  })};
 }
 if(JSON.stringify(out).length>MAX_RESULT)throw bad('Result too large.',400);
 return out;
}

async function cas(command,o,old,next){
 return Number(await command(['EVAL',CAS,1,key(o,old.id),JSON.stringify(old),JSON.stringify(next)]))===1;
}
export function createForgeLeadJobQueue({command=teamCommand,now=Date.now,uuid=randomUUID}={}){
 async function read(owner,id){
  if(!idOK(id))throw bad('Invalid job.',400);
  const value=await command(['GET',key(owner,id)]);
  if(!value)throw bad('Job not found.',404);
  return JSON.parse(value);
 }
 async function records(owner){
  const ids=await command(['LRANGE',index(owner),'0',String(MAX_QUEUE-1)])||[];
  if(!ids.length)return [];
  return (await command(['MGET',...ids.map(id=>key(owner,id))])||[]).filter(Boolean).map(x=>JSON.parse(x));
 }
 const list=async owner=>(await records(owner)).map(publicJob);
 async function getResult(owner,id){
  const job=await read(owner,id);
  if(job.status!=='done')throw bad('No result yet.',409);
  const raw=await command(['GET',resultKey(owner,id)]);
  if(!raw)throw bad('Result expired.',404);
  return JSON.parse(raw);
 }
 async function create(owner,device,input={}){
  if(!deviceOK(device))throw bad('Pair your Ally to Nexus first.',409);
  if(!requestOK(input.request_id))throw bad('Missing submit ID.',400);
  let spec=normalizeSpec(input);
  if(spec.kind==='build'){
   if(!idOK(input.source_id))throw bad('Choose a finished search first.',400);
   const source=await read(owner,input.source_id);
   if(source.kind!=='search'||source.status!=='done'||source.device_id!==device)throw bad('That search is not finished on this Ally.',409);
   const found=await getResult(owner,input.source_id);
   if(spec.picks!=='eligible'&&spec.picks.some(n=>n>found.leads.length))throw bad('Pick numbers from the list.',400);
   spec={...spec,source_id:input.source_id,batch:found.batch};
  }
  const id=digest(owner+'\n'+input.request_id),fingerprint=JSON.stringify(spec);
  const existing=await command(['GET',key(owner,id)]);
  const same=r=>JSON.stringify(r.spec)===fingerprint&&r.device_id===device;
  if(existing){
   const old=JSON.parse(existing);
   if(!same(old))throw bad('This submit ID was already used for a different job.',409);
   return publicJob(old);
  }
  const active=(await records(owner)).filter(x=>['queued','processing'].includes(x.status)).length;
  if(active>=MAX_ACTIVE)throw bad('Your Ally queue is full. Wait for a job to finish.',409);
  const record={id,request_id:input.request_id,kind:spec.kind,spec,device_id:device,status:'queued',stage:'waiting_for_ally',
   created_at:now(),updated_at:now(),error:'',token:null,lease_until:0,cancel_requested:false,has_result:false};
  if(await command(['SET',key(owner,id),JSON.stringify(record),'NX','EX',String(TTL)])==='OK'){
   await command(['LPUSH',index(owner),id]);
   await command(['LTRIM',index(owner),'0',String(MAX_QUEUE-1)]);
   await command(['EXPIRE',index(owner),String(TTL)]);
   return publicJob(record);
  }
  const winner=await read(owner,id);
  if(!same(winner))throw bad('This submit ID belongs to a different job.',409);
  return publicJob(winner);
 }
 async function cancel(owner,id){
  const old=await read(owner,id);
  if(['done','canceled'].includes(old.status))return publicJob(old);
  if(old.status==='needs_help')throw bad('An uncertain job needs a look on the Ally first.',409);
  const next=old.status==='queued'?{...old,status:'canceled',stage:'canceled',updated_at:now()}:{...old,cancel_requested:true,updated_at:now()};
  if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
  return publicJob(next);
 }
 async function claim(owner,device){
  const all=await records(owner);
  for(const r of all){
   if(r.device_id!==device||r.status!=='processing')continue;
   if(r.lease_until>now())return null;
   const failed={...r,status:'needs_help',stage:'interrupted',error:'The Ally stopped during this job. Start it again if you still want it.',token:null,lease_until:0,updated_at:now()};
   if(!await cas(command,owner,r,failed))return null;
  }
  for(const r of [...all].reverse()){
   if(r.device_id!==device||r.status!=='queued')continue;
   const next={...r,status:'processing',stage:'claimed',token:uuid(),lease_until:now()+LEASE_MS,updated_at:now()};
   if(!await cas(command,owner,r,next))continue;
   const s=r.spec;
   return r.kind==='search'?{id:r.id,token:next.token,kind:'search',business:s.business,city:s.city,count:s.count}
    :{id:r.id,token:next.token,kind:'build',batch:s.batch,picks:s.picks,offer:s.offer};
  }
  return null;
 }
 async function authorized(owner,device,{id,token}={}){
  if(!idOK(id)||!tokenOK(token))throw bad('Invalid claim.',403);
  const r=await read(owner,id);
  if(r.device_id!==device||r.token!==token||r.status!=='processing'||r.lease_until<=now())throw bad('Claim is no longer active.',409);
  return r;
 }
 async function heartbeat(owner,device,input={}){
  const old=await authorized(owner,device,input);
  if(!STAGES.includes(input.stage))throw bad('Unrecognized job stage.',400);
  const next={...old,stage:input.stage,updated_at:now(),lease_until:now()+LEASE_MS};
  if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
  return {cancel_requested:!!next.cancel_requested};
 }
 async function complete(owner,device,input={}){
  const old=await authorized(owner,device,input);
  if(old.cancel_requested)throw bad('Stop requested. Do not mark completed.',409);
  const result=validateResult(old.kind,input.result);
  if(old.kind==='build'&&result.batch!==old.spec.batch)throw bad('Result is for a different batch.',409);
  await command(['SET',resultKey(owner,old.id),JSON.stringify(result),'EX',String(TTL)]);
  const next={...old,status:'done',stage:'done',has_result:true,token:null,lease_until:0,updated_at:now()};
  if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
  return publicJob(next);
 }
 async function fail(owner,device,input={}){
  const old=await authorized(owner,device,input);
  if(typeof input.message!=='string'||input.message.length>180)throw bad('Failure message too long.',400);
  const next={...old,status:old.cancel_requested?'canceled':'needs_help',stage:old.cancel_requested?'canceled':'needs_attention',
   error:input.message.replace(/[\u0000-\u001f]/g,' ').slice(0,180),token:null,lease_until:0,updated_at:now()};
  if(!await cas(command,owner,old,next))throw bad('Job changed. Refresh.',409);
  return publicJob(next);
 }
 return {read,list,getResult,create,cancel,claim,heartbeat,complete,fail};
}
export const forgeLeadJobQueue=createForgeLeadJobQueue();
