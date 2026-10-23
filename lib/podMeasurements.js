import './store/installFetch.js';
import {normalizeModelUsage,aiWorkAmount,AI_WORK_POLICY} from './aiWorkUsage.js';
const KEY='nexus:pod-measurements:v1';
const LIMIT=500;
async function redis(command,env) {
  const response=await fetch(env.KV_REST_API_URL,{method:'POST',headers:{Authorization:`Bearer ${env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error('Measurement storage unavailable');
  const data=await response.json();if(data.error)throw new Error('Measurement storage rejected');return data.result;
}
const configured=env=>Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
export function beginPodMeasurement({kind='assistant',env=process.env,now=Date.now,command=value=>redis(value,env)}={}) {
  const started=now();let settled=false,bodyStarted=null;
  return {
    bodyReady(){bodyStarted=now();},
    async finish({success=true,usage,firstDeltaDelayMs}={}) {
      if(settled)return;settled=true;
      if(!configured(env))return;
      const ended=now(),normalized=normalizeModelUsage(usage);
      const record={at:ended,kind:['assistant','fresh','edit','owner','test'].includes(kind)?kind:'assistant',success:Boolean(success),durationMs:Math.max(0,ended-started),firstTokenMs:Number.isFinite(firstDeltaDelayMs) && bodyStarted!==null?Math.max(0,bodyStarted-started+firstDeltaDelayMs):null,usage:normalized.estimated?null:normalized,policyVersion:AI_WORK_POLICY.version};
      // Numeric runtime counters only: no prompts, outputs, identities, or keys.
      try {
        await command(['EVAL',"redis.call('LPUSH',KEYS[1],ARGV[1]);redis.call('LTRIM',KEYS[1],0,tonumber(ARGV[2])-1);redis.call('EXPIRE',KEYS[1],ARGV[3]);return 1",1,KEY,JSON.stringify(record),LIMIT,30*86400]);
      } catch {console.warn('Pod measurement could not be saved.');}
    },
  };
}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
export function summarizePodMeasurements(records) {
  const valid=records.filter(r=>Number.isFinite(r?.at)&&Number.isFinite(r.durationMs)&&r.durationMs>=0&&typeof r.success==='boolean');
  const successful=valid.filter(r=>r.success),measured=successful.filter(r=>r.usage && !r.usage.estimated),totals={input:0,output:0,cached:0,reasoning:0};
  for(const record of measured)for(const field of Object.keys(totals))totals[field]+=Number.isFinite(record.usage[field])?Math.max(0,record.usage[field]):0;
  const rates=measured.filter(r=>r.durationMs>0).map(r=>r.usage.output*1000/r.durationMs);
  return {sampleCount:valid.length,successful:successful.length,failed:valid.length-successful.length,reportedUsageSamples:measured.length,missingUsageSamples:successful.length-measured.length,firstSampleAt:valid.length?Math.min(...valid.map(r=>r.at)):null,lastSampleAt:valid.length?Math.max(...valid.map(r=>r.at)):null,latencyMs:{p50:percentile(successful.map(r=>r.durationMs),.5),p95:percentile(successful.map(r=>r.durationMs),.95)},firstTokenMs:{p50:percentile(successful.map(r=>r.firstTokenMs).filter(Number.isFinite),.5)},outputTokensPerRequestSecondP50:percentile(rates,.5),totals,measuredWorkUnits:measured.reduce((sum,r)=>sum+aiWorkAmount(r.usage),0),policyVersion:AI_WORK_POLICY.version};
}
export async function loadPodMeasurements({env=process.env,command=value=>redis(value,env)}={}) {
  if(!configured(env))return {configured:false,...summarizePodMeasurements([])};
  const raw=await command(['LRANGE',KEY,0,LIMIT-1]);
  const records=(Array.isArray(raw)?raw:[]).flatMap(item=>{try{return [JSON.parse(item)];}catch{return [];}});
  return {configured:true,...summarizePodMeasurements(records)};
}
