// The same claim → progress → result pattern as the render worker, with fenced leases and resumable checkpoints.
export async function workLabJobOnce({owner,id=null,store,service,workerId='lab-worker',sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),heartbeatMs=3000,env=process.env}){
 const job=await store.claim(owner,workerId,id);if(!job)return null;
 const lease=job.lease_token,abort=new AbortController();let stopped=false,beating=false;
 const heartbeat=async progress=>{try{return await store.heartbeat(owner,job.id,lease,progress);}catch(error){stopped=true;abort.abort();throw error;}};
 const timer=setInterval(()=>{if(beating||stopped)return;beating=true;heartbeat().catch(()=>{}).finally(()=>{beating=false;});},heartbeatMs);timer.unref?.();
 try{
  if(job.kind==='diagnostic'){
   const {steps,delay_ms}=job.input;for(let step=Number(job.checkpoint.completed)||0;step<steps;step++){await sleep(delay_ms);if(stopped)throw Error('worker stopped');await heartbeat({stage:`Checkpoint ${step+1} of ${steps}`,pct:(step+1)*99/steps});await store.checkpoint(owner,job.id,lease,{completed:step+1});}
   return await store.finish(owner,job.id,lease,{result:{message:'Background check completed; checkpoints were saved.'},provider:'nexus',model:'checkpoint-check-v1'});
  }
  await heartbeat({stage:'Running capability',pct:5});
  let previous=null;try{previous=await service.readRun(owner,job.id);}catch(error){if(error.status!==404)throw error;}
  if(previous?.status==='succeeded')return await store.finish(owner,job.id,lease,{result:{run_id:previous.id},provider:job.provider||'nexus',model:previous.engine});
  if(job.submission?.remote_id&&job.input.capability!=='video')throw Object.assign(Error('This provider needs its resume adapter.'),{code:'SUBMISSION_UNCERTAIN'});
  if(job.input.capability==='search'&&job.input.mode==='semantic'){if(!env.VOYAGE_API_KEY)throw Error('The semantic connection is unavailable.');await store.submission(owner,job.id,lease,{provider:'voyage',model:env.VOYAGE_EMBED_MODEL||'voyage-3.5-lite'});}
  const run=await service.run(owner,job.input,{runId:job.id,signal:abort.signal,job,store,lease});
  if(run.pending)return await store.defer(owner,job.id,lease,{delayMs:run.retryAfterMs,stage:run.stage||'waiting for provider'});
  await heartbeat({stage:'Saving result',pct:99});
  return await store.finish(owner,job.id,lease,{result:{run_id:run.id},provider:run.provider||(job.input.mode==='semantic'?'voyage':'nexus'),model:run.engine,costUsd:run.costUsd??null});
 }catch(error){
  let current;try{current=await store.get(owner,job.id);}catch{return null;}
  if(current.status!=='running'||stopped)return current;
  try{return await store.fail(owner,job.id,lease,error.code==='PROVIDER_FAILED'?'PROVIDER_FAILED':current.submission?'SUBMISSION_UNCERTAIN':'JOB_FAILED');}catch{return await store.get(owner,job.id);}
 }finally{clearInterval(timer);abort.abort();}
}
export async function sweepLabJobs({store,service,maxJobs=2}){let processed=0;const outcomes=[];for(const owner of await store.owners()){await store.list(owner);while(processed<maxJobs){const result=await workLabJobOnce({owner,store,service,workerId:'lab-sweep'});if(!result)break;outcomes.push({id:result.id,status:result.status});processed++;}if(processed>=maxJobs)break;}return {processed,outcomes};}
