import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchStore,QUEUE_TIMEOUT_MS} from '../lib/researchJobs.js';
import {compactionAction,PAID_REPORT_KEEP_MS} from '../lib/jobReceipts.js';
function fixture({refundFails=false}={}){
 const h=new Map();let t=1000;
 const command=async parts=>{
  const [cmd,,...rest]=parts;
  if(cmd==='HGET')return h.get(rest[0])??null;
  if(cmd==='HVALS')return [...h.values()];
  if(cmd==='HDEL'){h.delete(rest[0]);return 1;}
  if(cmd==='EVAL'){
   const [field,old,next,limit]=parts.slice(4),rec=JSON.parse(next);
   if(refundFails&&rec.ledger?.at(-1)?.why==='refund'){refundFails=false;throw new Error('transient wallet write failure');}
   if((h.get(field)||'')!==old)return 0;
   if(!h.has(field)&&h.size>=Number(limit))return -1;
   h.set(field,next);return 1;
  }
  throw Error('Unexpected '+cmd);
 };
 return {s:createResearchStore({command,now:()=>t,wake:async()=>({woke:false})}),advance:ms=>{t+=ms;}};
}
test('old purchase remains deduplicated after more than 200 later grants',async()=>{
 const {s}=fixture();const {link_id}=await s.createLink({label:'wallet',credits:8});
 await s.addCredits({link_id,credits:50,ref:'cs_original_payment'});
 for(let i=0;i<205;i++)await s.addCredits({link_id,credits:1,ref:'later-'+i});
 assert.equal((await s.addCredits({link_id,credits:50,ref:'cs_original_payment'})).credits,263);
});
test('an unwoken queued job refunds automatically at deadline, once',async()=>{
 const {s,advance}=fixture();const w=await s.createLink({label:'wallet',credits:8});
 const j=await s.submit(w.token,{competitor:'Example'});advance(QUEUE_TIMEOUT_MS+1);
 await s.recover();await s.recover();
 assert.equal((await s.walletByToken(w.token)).credits,8);
 assert.equal((await s.status(w.token,{job_id:j.job_id})).status,'failed');
 assert.equal((await s.claim({job_id:j.job_id})).claimed,false);
});
test('an expired paid worker cannot complete or reclaim a refunded job',async()=>{
 const {s,advance}=fixture();const w=await s.createLink({label:'wallet',credits:8});const j=await s.submit(w.token,{competitor:'Example'});
 await s.claim({job_id:j.job_id});advance(31*60*1000);
 await assert.rejects(()=>s.complete({job_id:j.job_id,result:{summary:'late'}}),{code:'JOB_EXPIRED'});
 assert.equal((await s.walletByToken(w.token)).credits,8);
 assert.equal((await s.claim({job_id:j.job_id})).claimed,false);
});
test('a transient refund error is retried instead of losing the refund',async()=>{
 const {s,advance}=fixture({refundFails:true});const w=await s.createLink({label:'wallet',credits:8});const j=await s.submit(w.token,{competitor:'Example'});
 advance(QUEUE_TIMEOUT_MS+1);assert.equal((await s.recover()).pending,1);await s.recover();
 assert.equal((await s.walletByToken(w.token)).credits,8);
 assert.match((await s.status(w.token,{job_id:j.job_id})).error,/credits were put back/);
});
test('wallet history stays private to the wallet and reports survive seven days',async()=>{
 const {s,advance}=fixture();const a=await s.createLink({label:'A',credits:16}),b=await s.createLink({label:'B',credits:8});
 const j=await s.submit(a.token,{competitor:'Private example'});await s.claim({job_id:j.job_id});await s.complete({job_id:j.job_id,result:{summary:'Paid report'}});
 assert.equal((await s.history(a.token))[0].job_id,j.job_id);assert.deepEqual(await s.history(b.token),[]);
 advance(8*24*60*60*1000);await s.submit(a.token,{competitor:'Another'});
 assert.equal((await s.status(a.token,{job_id:j.job_id})).result.summary,'Paid report');
});
test('paid reports archive after 90 days; free-link retention is unchanged',()=>{
 const j={kind:'j',status:'done',cost:8,completed_at:1000};
 assert.equal(compactionAction(j,1000+8*24*60*60*1000),null);
 assert.equal(compactionAction(j,1000+PAID_REPORT_KEEP_MS+1),'archive');
 assert.equal(compactionAction({...j,cost:0},1000+8*24*60*60*1000),'archive');
});
