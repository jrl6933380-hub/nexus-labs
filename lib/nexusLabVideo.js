import {createHash} from 'node:crypto';
import {MEDIA_LIMITS,sniffMedia} from './adMedia.js';
import {adapterReady,mediaError,mediaInput,readLabMedia} from './nexusLabMedia.js';
export function validateVideoInput(input){
 const clean=mediaInput(input,'video',{maxAssets:2,allowEmpty:true});
 if(!Number.isInteger(input.seconds)||input.seconds<1||input.seconds>10)throw mediaError('Choose a video duration from 1 to 10 seconds.');
 if(!['portrait','square','landscape'].includes(input.aspect))throw mediaError('Choose portrait, square or landscape.');
 return {...clean,seconds:input.seconds,aspect:input.aspect};
}
const remoteId=value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,200}$/.test(value);
export function createNexusLabVideo({assets,provider=null}={}){
 const ready=()=>adapterReady(provider,['submit','poll']);
 async function saveOutput(owner,raw,input,options){
  const bytes=raw?.bytes;
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>20*1024*1024)throw mediaError('The video output must be 16 bytes to 20 MiB.',502);
  const real=sniffMedia(bytes);
  if(!real||real.kind!=='video')throw mediaError('Provider output is not a supported video file.',502);
  if(!Number.isInteger(raw.width)||raw.width<1||raw.width>20000||!Number.isInteger(raw.height)||raw.height<1||raw.height>20000||!Number.isFinite(raw.seconds)||raw.seconds<=0||raw.seconds>120)throw mediaError('Invalid output dimensions or duration.',502);
  const sha256=createHash('sha256').update(bytes).digest('hex'),{store,job,lease,signal}=options;
  signal?.throwIfAborted();await store.heartbeat(owner,job.id,lease,{stage:'Saving video asset',pct:90});
  let asset;
  if(job.checkpoint.output_asset_id){
   if(job.checkpoint.output_sha256!==sha256)throw mediaError('Provider output changed after upload began.',409);
   asset=await assets.read(owner,job.checkpoint.output_asset_id);
  }else{
   asset=await assets.begin(owner,{name:'lab-'+job.id+'.'+real.ext,description:'Generated Lab video',kind:'video',bytes:bytes.length,sha256,width:raw.width,height:raw.height,seconds:raw.seconds,
    provenance:{role:input.asset_ids.length?'clip':'original',origin:'generated',parent_ids:input.asset_ids,notes:'Lab run '+job.id+'; provider '+provider.id+'; model '+provider.model}});
   await store.checkpoint(owner,job.id,lease,{output_asset_id:asset.media_id,output_sha256:sha256});
  }
  if(asset.sha256!==sha256||asset.bytes!==bytes.length)throw mediaError('Saved video metadata does not match provider output.',409);
  if(asset.status!=='ready'){
   for(let index=0;index<asset.chunks;index++){
    signal?.throwIfAborted();await store.heartbeat(owner,job.id,lease,{stage:'Uploading video chunk',pct:90});
    await assets.putChunk(owner,{media_id:asset.media_id,index,data_base64:bytes.subarray(index*MEDIA_LIMITS.chunkBytes,(index+1)*MEDIA_LIMITS.chunkBytes).toString('base64')});
   }
   asset=await assets.finish(owner,{media_id:asset.media_id});
  }
  await store.heartbeat(owner,job.id,lease,{stage:'Video saved',pct:98});
  return asset;
 }
 return {
  connection(){return {status:ready()?'verified_adapter':'needs_connection',provider:ready()?provider.id:null,model:ready()?provider.model:null};},
  async execute(owner,input,options={}){
   const clean=validateVideoInput(input);
   if(!ready())throw mediaError('Video needs a selected and verified provider.',409);
   const {job,store,lease,signal}=options;
   if(!job||!store||!lease)throw mediaError('Video must run as a durable Lab job.',409);
   if(provider.supports&&!provider.supports(clean))throw mediaError('This provider does not support those video settings.',409);
   let remote=job.submission?.remote_id;
   if(job.submission&&(job.submission.provider!==provider.id||job.submission.model!==provider.model))throw mediaError('Resume with the original video provider and model.',409);
   if(!remote){
    if(job.submission)throw Object.assign(mediaError('The prior video submission needs reconciliation.',409),{code:'SUBMISSION_UNCERTAIN'});
    const media=await readLabMedia(owner,clean.asset_ids,{assets,kinds:['image'],maxBytes:10*1024*1024,maxTotal:20*1024*1024,signal});
    signal?.throwIfAborted();
    await store.submission(owner,job.id,lease,{provider:provider.id,model:provider.model});
    const accepted=await provider.submit({prompt:clean.prompt,media,seconds:clean.seconds,aspect:clean.aspect,idempotencyKey:job.id,signal});
    if(!remoteId(accepted?.remote_id))throw mediaError('The video provider did not return a valid job identity.',502);
    remote=accepted.remote_id;
    await store.submission(owner,job.id,lease,{provider:provider.id,model:provider.model,remote_id:remote});
   }
   // Revalidate owner access on every resumption without uploading the reference again.
   for(const id of clean.asset_ids)await assets.read(owner,id);
   signal?.throwIfAborted();await store.heartbeat(owner,job.id,lease,{stage:'Checking video provider',pct:20});
   const polled=await provider.poll({remoteId:remote,idempotencyKey:job.id,signal});
   signal?.throwIfAborted();
   if(['queued','running'].includes(polled?.status)){
    const progress=Number.isFinite(polled.progress)?Math.max(20,Math.min(85,polled.progress)):20;
    await store.heartbeat(owner,job.id,lease,{stage:'Waiting for video',pct:progress});
    return {pending:true,retryAfterMs:Math.max(1000,Math.min(30000,Number.isFinite(polled.retryAfterMs)?polled.retryAfterMs:5000))};
   }
   if(polled?.status==='failed')throw Object.assign(mediaError('The video provider reported failure.',502),{code:'PROVIDER_FAILED'});
   if(polled?.status!=='succeeded')throw mediaError('The video provider returned an unknown status.',502);
   if(polled.costUsd!==undefined&&polled.costUsd!==null&&(!Number.isFinite(polled.costUsd)||polled.costUsd<0))throw mediaError('Invalid video provider cost.',502);
   const asset=await saveOutput(owner,polled.video,clean,options);
   return {input:clean,provider:provider.id,engine:provider.model,costUsd:polled.costUsd??null,input_asset_ids:clean.asset_ids,output_asset_ids:[asset.media_id],
    output:{asset_id:asset.media_id,mime:asset.mime,sha256:asset.sha256,bytes:asset.bytes,width:asset.width,height:asset.height,seconds:asset.seconds,
     handoff:{path:'/ads.html',media_id:asset.media_id,note:'Available in the shared Ads media picker. Attach it to an ad request; no campaign was created or published.'}}};
  },
  async cancel(owner,job){
   if(!owner?.id)throw mediaError('Owner authentication required.',401);
   if(job.status!=='canceled')throw mediaError('Cancel the local job first.',409);
   const remote=job.submission?.remote_id;
   if(!remote||!ready()||job.submission.provider!==provider.id||job.submission.model!==provider.model||typeof provider.cancel!=='function')return {scope:'local_only'};
   try{const result=await provider.cancel({remoteId:remote,idempotencyKey:job.id,signal:AbortSignal.timeout(10000)});
    return {scope:result?.canceled===true?'provider_confirmed':'local_only'};
   }catch{return {scope:'local_only'};}
  },
 };
}
