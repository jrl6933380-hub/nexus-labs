import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {adCampaignStore} from '../lib/adCampaigns.js';
import {adMediaStore,MEDIA_LIMITS,isMediaId} from '../lib/adMedia.js';
import {adImageStore} from '../lib/adImages.js';
import {resolveProjectImages} from './ad-campaigns.js';
import {adRenderJobStore} from '../lib/adRenderJobs.js';
import {workspaceRequests} from '../lib/workspaceRequests.js';
import {adVoiceovers} from '../lib/adVoiceovers.js';
import {isSpecV2} from '../public/ad-vocabulary.mjs';
// A 384 KiB media chunk is 512 KiB as JSON, larger than the MCP endpoint's parser.
export const config={api:{bodyParser:{sizeLimit:'1mb'}}};
export const MAX_VOICE_BYTES=8*1024*1024;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const fields={state:[],begin:['name','bytes','sha256'],chunk:['media_id','index','data_base64'],finish:['media_id'],audio_chunk:['media_id','index'],render:['baseline'],status:['job_id'],video_chunk:['job_id','index']};
const writes=new Set(['begin','chunk','finish','render']);
export function createAdVoiceoverHandler({resolveAccount=resolveWorkspaceAccount,ads=adCampaignStore,media=adMediaStore,images=adImageStore,jobs=adRenderJobStore,voices=adVoiceovers,once=workspaceRequests}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   const origin=req.headers?.origin,host=req.headers?.host;
   if((origin&&new URL(origin).host!==host)||req.headers?.['sec-fetch-site']==='cross-site')throw fail('Open this ad on the Nexus site.',403);
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))throw fail('Use application/json.',415);
   const account=await resolveAccount(req),body=req.body;
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','input','request_id'].includes(k)))throw fail('Provide action, input and request_id only.');
   const {action,input={},request_id}=body;
   if(!Object.hasOwn(fields,action)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['campaign_id',...fields[action]].includes(k)))throw fail('Invalid voiceover request.');
   const record=await ads.read(account.id,input.campaign_id);
   if(!isSpecV2(record.project))throw fail('Voiceovers work with the current ad format.');
   const audio=async id=>{
    if(!isMediaId(id))throw fail('Choose a voiceover file.');
    const m=await media.read(account.id,id);
    if(m.kind!=='audio'||m.bytes>MAX_VOICE_BYTES)throw fail('Choose an audio file up to 8 MB.');
    return m;
   };
   const job=async()=>{const j=await jobs.get(account.id,input.job_id);if(j.kind!=='mp4'||j.campaign_id!==input.campaign_id)throw fail('Video not found for this ad.',404);return j;};
   const operation=async()=>{
    if(action==='begin'){
     if(!Number.isInteger(input.bytes)||input.bytes<16||input.bytes>MAX_VOICE_BYTES)throw fail('Choose an audio file up to 8 MB.');
     return media.begin(account.id,{name:input.name,bytes:input.bytes,sha256:input.sha256,kind:'audio',description:'Voiceover for ad '+input.campaign_id});
    }
    if(action==='chunk'){
     const m=await audio(input.media_id);
     if(!Number.isInteger(input.index)||typeof input.data_base64!=='string'||input.data_base64.length>Math.ceil(MEDIA_LIMITS.chunkBytes/3)*4)throw fail('Invalid audio chunk.');
     return media.putChunk(account.id,m.media_id,input.index,input.data_base64);
    }
    if(action==='finish'){
     await audio(input.media_id);
     const m=await media.finish(account.id,input.media_id);
     if(m.kind!=='audio'||m.status!=='ready')throw fail('This file is not ready audio.');
     await voices.set(account.id,input.campaign_id,m.media_id);
     return {voiceover:{media_id:m.media_id,name:m.name,bytes:m.bytes,mime:m.mime,chunks:m.chunks,sha256:m.sha256}};
    }
    if(action==='audio_chunk'){
     const a=await voices.get(account.id,input.campaign_id);
     if(!a||a.media_id!==input.media_id)throw fail('Voiceover not attached to this ad.',404);
     await audio(input.media_id);
     return media.getChunk(account.id,input.media_id,input.index);
    }
    if(action==='render'){
     if(record.baseline!==input.baseline)throw fail('This ad changed. Reload it before exporting.',409);
     const a=await voices.get(account.id,input.campaign_id);
     const m=await audio(a?.media_id);
     if(m.status!=='ready')throw fail('Finish uploading the voiceover first.');
     const resolved=await resolveProjectImages(account.id,record.project,images,media);
     if(resolved.missing.length)throw fail('This ad is missing media. Restore it before exporting.');
     return jobs.create(account.id,{kind:'mp4',campaign_id:input.campaign_id,project:record.project,baseline:record.baseline,options:{quality:'final',fps:24,scale:2,crf:19,audio_media_id:m.media_id}});
    }
    if(action==='status')return job();
    if(action==='video_chunk'){await job();return jobs.chunk(account.id,input.job_id,'ad.mp4',input.index);}
    const attachment=await voices.get(account.id,input.campaign_id);
    let voiceover=null;
    if(attachment){try{const m=await audio(attachment.media_id);if(m.status==='ready')voiceover={media_id:m.media_id,name:m.name,bytes:m.bytes,mime:m.mime,chunks:m.chunks,sha256:m.sha256};}catch(e){if(e.status!==404)throw e;}}
    const render=voiceover?((await jobs.list(account.id)).jobs.filter(j=>j.kind==='mp4'&&j.campaign_id===input.campaign_id&&j.baseline===record.baseline&&j.options?.audio_media_id===voiceover.media_id).sort((a,b)=>b.created_at-a.created_at)[0]||null):null;
    return {voiceover,render,baseline:record.baseline};
   };
   const data=writes.has(action)?await once(account.id,request_id,'ad_voice_'+action,input,operation):await operation();
   return res.status(200).json({ok:true,data});
  }catch(e){return res.status(e.status||400).json({error:e.status>=500?'Voiceover service is unavailable. Try again shortly.':e.message});}
 };
}
export default createAdVoiceoverHandler();
