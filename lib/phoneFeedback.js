/** Observe an already-enqueued phone command. Never enqueues, repeats or caches an action/image. */
export async function waitForPhoneFeedback({receipt,read,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=10000,pollMs=250}){
 if(!receipt?.command_id)return receipt;
 const started=now(),budget=Math.max(0,Math.min(10000,Number.isFinite(timeoutMs)?timeoutMs:10000));
 const interval=Math.max(50,Math.min(1000,Number.isFinite(pollMs)?pollMs:250));
 const deadline=started+budget;
 const pending=(last,note)=>({...receipt,...last,requires_result_read:true,waited_ms:Math.max(0,now()-started),next:note||'Read read_nexus_phone_result with this command_id. Do not enqueue the action again.'});
 let last={status:receipt.status||'queued'};
 // An attempt cap keeps test clocks or an unavailable timer from making the wait unbounded.
 const attempts=Math.ceil(budget/interval)+1;
 for(let attempt=0;attempt<attempts;attempt++){
  let observed;
  let timer;
  try{
   observed=await Promise.race([
    Promise.resolve().then(()=>read(receipt.command_id)),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Phone observation timed out.')),Math.max(1,deadline-now()));}),
   ]);
  }catch(error){
   if(error?.status===410||error?.status===401||error?.status===403)return {...receipt,status:'unavailable',requires_result_read:false,waited_ms:Math.max(0,now()-started),next:'The phone session or access is no longer available. Reconnect and inspect a new screen before deciding on another action.'};
   return pending(last,'The action was queued, but its result could not be read. Read read_nexus_phone_result with this command_id; do not repeat the action.');
  }finally{clearTimeout(timer);}
  if(observed?.status==='done')return {...receipt,...observed,requires_result_read:false,waited_ms:Math.max(0,now()-started),next:observed.frame_id?'Use this returned image and fresh frame_id for the next requested action; no separate result read is needed.':observed.ok===true?'Action completed. If screen_error is present, request a fresh screen; do not repeat the action.':'Inspect the reported error and a fresh screen before deciding what to do. Do not blindly repeat the action.'};
  if(observed?.status==='expired')return {...receipt,...observed,requires_result_read:false,waited_ms:Math.max(0,now()-started),next:'This command expired and may have executed. Inspect a fresh screen; never retry an uncertain action blindly.'};
  // Completion updates the queue state before writing its expiring result. Unavailable can be that brief gap.
  if(observed?.status==='unavailable'&&now()>=(receipt.expires_at||0))return {...receipt,...observed,requires_result_read:false,waited_ms:Math.max(0,now()-started),next:'The result is no longer available. Inspect a fresh screen before deciding on another action.'};
  if(observed&&['queued','delivered'].includes(observed.status))last=observed;
  if(now()>=deadline||attempt===attempts-1)break;
  await sleep(Math.min(interval,deadline-now()));
 }
 return pending(last);
}
