import {adapterReady,mediaError,mediaInput,readLabMedia} from './nexusLabMedia.js';
export const validateUnderstandInput=input=>mediaInput(input,'understand');
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw mediaError('Invalid provider '+label+'.',502);return value.trim();}
export function understandOutput(raw,media){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw mediaError('Invalid multimodal response.',502);
 const known=new Map(media.map(m=>[m.asset_id,m]));
 const entries=(values,label,max)=>{if(values===undefined)return [];if(!Array.isArray(values)||values.length>max)throw mediaError('Too many '+label+' entries.',502);return values.map(item=>{
  if(!item||!known.has(item.asset_id))throw mediaError('Provider referenced an unknown asset.',502);
  const m=known.get(item.asset_id),value={asset_id:item.asset_id,text:text(item.text,2000,label)};
  if(item.start_seconds!==undefined||item.end_seconds!==undefined){
   if(m.kind==='image'||!Number.isFinite(item.start_seconds)||!Number.isFinite(item.end_seconds)||item.start_seconds<0||item.end_seconds<item.start_seconds||item.end_seconds>m.seconds)throw mediaError('Invalid source timestamp.',502);
   value.start_seconds=item.start_seconds;value.end_seconds=item.end_seconds;
  }
  return value;
 });};
 const output={summary:text(raw.summary,2000,'summary'),observations:entries(raw.observations,'observation',40),transcript:entries(raw.transcript,'transcript',100),limitations:[]};
 if(raw.limitations!==undefined){if(!Array.isArray(raw.limitations)||raw.limitations.length>12)throw mediaError('Invalid provider limitations.',502);output.limitations=raw.limitations.map(v=>text(v,500,'limitation'));}
 if(!output.observations.length&&!output.transcript.length)throw mediaError('Multimodal output needs source-linked observations or transcript.',502);
 if(JSON.stringify(output).length>100000)throw mediaError('Multimodal result exceeds its bound.',502);
 return output;
}
export function createNexusLabUnderstand({assets,provider=null}={}){
 const ready=()=>adapterReady(provider,['analyze'])&&Array.isArray(provider.modalities)&&provider.modalities.length>0&&provider.modalities.every(k=>['image','audio','video'].includes(k));
 return {
  connection(){return {status:ready()?'verified_adapter':'needs_connection',provider:ready()?provider.id:null,model:ready()?provider.model:null,modalities:ready()?[...provider.modalities]:[]};},
  async execute(owner,input,options={}){
   const clean=validateUnderstandInput(input);
   if(!ready())throw mediaError('Understand needs a verified multimodal provider.',409);
   if(!options.job||!options.store||!options.lease)throw mediaError('Understand must run as a durable Lab job.',409);
   if(options.job.submission)throw Object.assign(mediaError('Understand submission needs reconciliation before another call.',409),{code:'SUBMISSION_UNCERTAIN'});
   const media=await readLabMedia(owner,clean.asset_ids,{assets,kinds:provider.modalities,signal:options.signal});
   options.signal?.throwIfAborted();
   await options.store.submission(owner,options.job.id,options.lease,{provider:provider.id,model:provider.model});
   // The provider must pass the stable identity to its request; unknown outcomes never auto-resubmit.
   const raw=await provider.analyze({prompt:clean.prompt,media,idempotencyKey:options.job.id,signal:options.signal});
   options.signal?.throwIfAborted();
   const output=understandOutput(raw,media);
   await options.store.heartbeat(owner,options.job.id,options.lease,{stage:'Validated multimodal result',pct:95});
   if(raw.costUsd!==undefined&&raw.costUsd!==null&&(!Number.isFinite(raw.costUsd)||raw.costUsd<0))throw mediaError('Invalid provider cost.',502);
   return {input:clean,output,provider:provider.id,engine:provider.model,costUsd:raw.costUsd??null,input_asset_ids:clean.asset_ids,output_asset_ids:[]};
  },
 };
}
