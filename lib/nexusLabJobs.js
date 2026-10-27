import {createHash,randomUUID} from 'node:crypto';
import {getStore} from './store/index.js';
export {JOB_STATES} from './jobStates.js';
export const LAB_JOB_LIMITS=Object.freeze({maxActive:3,maxRetained:60,maxAttempts:3,leaseMs:15000,deadlineMs:10*60000,maxInputChars:125000});
const ID=/^lab-[a-f0-9]{24}$/u;
const OWNERS='nexus:lab-jobs:v1:owners';
const CAS="if redis.call('HGET',KEYS[1],ARGV[1]) ~= ARGV[2] then return 0 end redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]) return 1";
const fail=(message,status=400,code='JOB_INVALID')=>Object.assign(new Error(message),{status,code});
const key=owner=>{if(typeof owner?.id!=='string'||!owner.id)throw fail('Owner authentication required.',401);return `nexus:lab-jobs:v1:${encodeURIComponent(owner.id)}`;};
const stable=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const hash=value=>createHash('sha256').update(value).digest('hex');
const active=r=>['queued','running'].includes(r.status);
const event=(r,at,stage)=>{r.events=[...(r.events||[]),{at,stage}].slice(-30);};
const publicJob=r=>{const {lease_token,input,request_hash,worker,...safe}=r;return {...safe,active:active(r),retry_allowed:!r.compacted&&['failed','canceled'].includes(r.status)&&!r.submission&&r.attempts<LAB_JOB_LIMITS.maxAttempts};};
function validate(kind,input){
 if(!['run','diagnostic'].includes(kind))throw fail('Choose a supported background job.');
 if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>LAB_JOB_LIMITS.maxInputChars)throw fail('The job input is invalid or too large.');
 if(kind==='diagnostic'){const steps=input.steps??10,delay_ms=input.delay_ms??500;if(!Number.isInteger(steps)||steps<1||steps>30||!Number.isInteger(delay_ms)||delay_ms<10||delay_ms>1000||steps*delay_ms>30000)throw fail('The background check must take at most 30 seconds.');return {steps,delay_ms};}
 if(!['search','rank','predict'].includes(input.capability))throw fail('This capability is not connected for background execution.',409);
 if(input.capability==='predict'){if(!Array.isArray(input.values)||input.values.length<6||input.values.length>200||input.values.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12))throw fail('Supply 6–200 finite numeric observations.');return {capability:'predict',values:input.values};}
 const query=String(input.query||'').trim();if(!query||query.length>500)throw fail('Enter a brief of 1–500 characters.');
 if(input.capability==='rank'){if(!Array.isArray(input.candidates)||!input.candidates.length||input.candidates.length>60||input.candidates.some(v=>typeof v!=='string'||!v.trim()||v.length>2000))throw fail('Supply 1–60 text candidates of at most 2,000 characters.');return {capability:'rank',query,candidates:input.candidates};}
 if(input.mode!==undefined&&!['keyword','semantic'].includes(input.mode))throw fail('Choose keyword or semantic search.');return {capability:'search',query,mode:input.mode||'keyword'};
}
export function createNexusLabJobs({command=async args=>{const store=getStore();if(!store)throw fail('Lab job storage is unavailable.',503);return store.command(args);},now=Date.now,token=()=>randomUUID()}={}){
 async function queueLock(owner,task){const lock=key(owner)+':enqueue',lease=token();if(await command(['SET',lock,lease,'NX','EX','60'])!=='OK')throw fail('Another job change is in progress. Retry with the same request ID.',409);try{return await task();}finally{await command(['EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",'1',lock,lease]);}}
 const all=async owner=>(await command(['HVALS',key(owner)])||[]).map(v=>JSON.parse(v));
 async function read(owner,id){if(!ID.test(String(id)))throw fail('Choose a Lab job.');const raw=await command(['HGET',key(owner),id]);if(!raw)throw fail('Lab job not found.',404);return JSON.parse(raw);}
 async function change(owner,id,update){for(let i=0;i<8;i++){const r=await read(owner,id),raw=JSON.stringify(r),next=update(r);if(!next)return r;if(Number(await command(['EVAL',CAS,'1',key(owner),id,raw,JSON.stringify(next)])))return next;}throw fail('This job changed. Refresh and try again.',409,'JOB_CONFLICT');}
 function owns(r,lease){if(r.status!=='running'||r.lease_token!==lease||r.lease_until<=now())throw fail('This worker lease is no longer valid.',409,'LEASE_LOST');}
 async function recover(owner){for(const r of await all(owner)){
   if(!active(r))continue;
   if(r.deadline_at<=now())await change(owner,r.id,latest=>{if(!active(latest)||latest.deadline_at>now())return null;latest.status='failed';latest.finished_at=now();latest.error={code:latest.submission?'SUBMISSION_UNCERTAIN':'JOB_EXPIRED',message:latest.submission?'Check the saved provider result before submitting again.':'This job exceeded its deadline.'};latest.lease_token=null;event(latest,now(),'deadline');return latest;});
   else if(r.status==='running'&&r.lease_until<=now())await change(owner,r.id,latest=>{if(latest.status!=='running'||latest.lease_until>now())return null;latest.lease_token=null;if(latest.submission&&!latest.submission.remote_id){latest.status='failed';latest.error={code:'SUBMISSION_UNCERTAIN',message:'The worker stopped after recording a provider submission. Check its outcome before submitting again.'};latest.finished_at=now();event(latest,now(),'reconciliation_required');}else if(latest.attempts>=LAB_JOB_LIMITS.maxAttempts){latest.status='failed';latest.error={code:'WORKER_LOST',message:'The worker could not finish after three attempts.'};latest.finished_at=now();event(latest,now(),'worker_lost');}else{latest.status='queued';event(latest,now(),'lease_recovered');}return latest;});
  }}
 const api={
  async enqueue(owner,{kind='run',input={},request_id}){
   key(owner);if(typeof request_id!=='string'||!/^[a-zA-Z0-9_-]{8,120}$/u.test(request_id))throw fail('Use a stable request ID of 8–120 letters, digits, underscores or hyphens.');
   const data=validate(kind,input),request_hash=hash(JSON.stringify(stable({kind,input:data}))),id='lab-'+hash(`${owner.id}\n${request_id}`).slice(0,24),existing=await command(['HGET',key(owner),id]);
   if(existing){const r=JSON.parse(existing);if(r.request_hash!==request_hash)throw fail('This request ID belongs to different input.',409,'REQUEST_ID_CONFLICT');return publicJob(r);}
   // The short account lock bounds active jobs. Per-job updates use fenced compare-and-set.
   return queueLock(owner,async()=>{
    const again=await command(['HGET',key(owner),id]);if(again){const r=JSON.parse(again);if(r.request_hash!==request_hash)throw fail('This request ID belongs to different input.',409);return publicJob(r);}
    await recover(owner);const rows=await all(owner);if(rows.filter(active).length>=LAB_JOB_LIMITS.maxActive)throw fail('Three jobs are already active. Wait or cancel one.',409);
    // Never evict request identities: terminal records compact instead, preserving deduplication.
    const finished=rows.filter(r=>!active(r)&&!r.compacted).sort((a,b)=>a.created_at-b.created_at);while(rows.filter(r=>!r.compacted).length>=LAB_JOB_LIMITS.maxRetained&&finished.length){const old=finished.shift();await change(owner,old.id,r=>({...r,input:{},events:[],result:r.result?.run_id?{run_id:r.result.run_id}:null,compacted:true}));old.compacted=true;}
    const at=now(),r={id,kind,label:kind==='diagnostic'?'Background check':data.capability,input:data,request_hash,status:'queued',attempts:0,created_at:at,deadline_at:at+LAB_JOB_LIMITS.deadlineMs,lease_until:0,lease_token:null,progress:{stage:'queued',pct:0},checkpoint:{},submission:null,result:null,error:null,provider:null,model:null,costUsd:null,events:[{at,stage:'queued'}]};
    await command(['SADD',OWNERS,owner.id]);await command(['HSET',key(owner),id,JSON.stringify(r)]);return publicJob(r);
   });
  },
  async list(owner){await recover(owner);return (await all(owner)).filter(r=>!r.compacted).sort((a,b)=>b.created_at-a.created_at).map(publicJob);},
  async get(owner,id){await recover(owner);return publicJob(await read(owner,id));},
  async owners(){return (await command(['SMEMBERS',OWNERS])||[]).slice(0,50).map(id=>({id}));},
  async claim(owner,worker,id=null){await recover(owner);const rows=(await all(owner)).filter(r=>r.status==='queued'&&(!id||r.id===id)).sort((a,b)=>a.created_at-b.created_at);for(const r of rows){const lease=token();const next=await change(owner,r.id,latest=>{if(latest.status!=='queued')return null;latest.status='running';latest.attempts++;latest.worker=String(worker).slice(0,80);latest.lease_token=lease;latest.lease_until=now()+LAB_JOB_LIMITS.leaseMs;latest.started_at=latest.started_at||now();latest.progress={...latest.progress,stage:latest.attempts>1?'resuming':'starting'};event(latest,now(),latest.progress.stage);return latest;});if(next.lease_token===lease)return next;}return null;},
  async heartbeat(owner,id,lease,progress){return publicJob(await change(owner,id,r=>{owns(r,lease);r.lease_until=now()+LAB_JOB_LIMITS.leaseMs;if(progress){if(typeof progress.stage!=='string'||progress.stage.length>80||!Number.isFinite(progress.pct))throw fail('Invalid job progress.');r.progress={stage:progress.stage,pct:Math.max(r.progress.pct,Math.max(0,Math.min(99,progress.pct)))};}return r;}));},
  async checkpoint(owner,id,lease,data){if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>8000)throw fail('Checkpoint must be a small object.');return publicJob(await change(owner,id,r=>{owns(r,lease);r.checkpoint=data;r.lease_until=now()+LAB_JOB_LIMITS.leaseMs;event(r,now(),'checkpoint');return r;}));},
  async submission(owner,id,lease,{provider,model,remote_id}){if(typeof provider!=='string'||provider.length>80||typeof model!=='string'||model.length>120||remote_id!==undefined&&(typeof remote_id!=='string'||!remote_id||remote_id.length>240))throw fail('Invalid provider checkpoint.');return publicJob(await change(owner,id,r=>{owns(r,lease);if(r.submission&&(r.submission.provider!==provider||r.submission.model!==model))throw fail('A provider submission is already recorded.',409);if(r.submission?.remote_id&&remote_id&&r.submission.remote_id!==remote_id)throw fail('Provider job identity cannot change.',409);r.provider=provider;r.model=model;r.submission={provider,model,idempotency_key:r.id,remote_id:remote_id||r.submission?.remote_id||null,recorded_at:r.submission?.recorded_at||now()};event(r,now(),remote_id?'provider_accepted':'submission_intent');return r;}));},
  async finish(owner,id,lease,{result,provider,model,costUsd=null}){if(result===undefined||JSON.stringify(result).length>16000||costUsd!==null&&(!Number.isFinite(costUsd)||costUsd<0))throw fail('Invalid job result.');return publicJob(await change(owner,id,r=>{owns(r,lease);r.status='succeeded';r.result=result;r.provider=provider||r.provider;r.model=model||r.model;r.costUsd=costUsd;r.progress={stage:'complete',pct:100};r.finished_at=now();r.lease_token=null;event(r,now(),'complete');return r;}));},
  async fail(owner,id,lease,code='JOB_FAILED'){return publicJob(await change(owner,id,r=>{owns(r,lease);r.status='failed';r.error={code,message:code==='SUBMISSION_UNCERTAIN'?'Check the saved provider outcome before submitting again.':'This job could not finish. See its checkpoints and try again when retry is available.'};r.finished_at=now();r.lease_token=null;event(r,now(),'failed');return r;}));},
  async cancel(owner,id){return publicJob(await change(owner,id,r=>{if(!active(r))return null;r.status='canceled';r.finished_at=now();r.lease_token=null;r.cancel_scope=r.submission?'local_only':'worker';event(r,now(),'canceled');return r;}));},
  async retry(owner,id){return queueLock(owner,async()=>{await recover(owner);if((await all(owner)).filter(active).length>=LAB_JOB_LIMITS.maxActive)throw fail('Three jobs are already active. Wait or cancel one.',409);return publicJob(await change(owner,id,r=>{if(r.compacted||!['failed','canceled'].includes(r.status)||r.submission||r.attempts>=LAB_JOB_LIMITS.maxAttempts)throw fail('This job cannot be retried safely. Check its saved outcome first.',409);r.status='queued';r.error=null;r.finished_at=null;r.deadline_at=now()+LAB_JOB_LIMITS.deadlineMs;event(r,now(),'retry_requested');return r;}));});},
 };
 return api;
}
export const nexusLabJobs=createNexusLabJobs();
