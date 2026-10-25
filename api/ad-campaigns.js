import {adDesignPreset} from '../lib/adDesigns.js';
import {resolveWorkspaceAccount,validateWorkspaceInput} from '../lib/workspaceConnector.js';
import {adCampaignStore} from '../lib/adCampaigns.js';
import {workspaceRequests} from '../lib/workspaceRequests.js';
import {adImageStore,imageIdsOf} from '../lib/adImages.js';
import {adMediaStore,isMediaId} from '../lib/adMedia.js';
import {adRenderJobStore} from '../lib/adRenderJobs.js';
import {createAdRenderLinks} from '../lib/adRenderPersist.js';
const adRenderLinks=createAdRenderLinks();
// Finished MP4 per ad. Renders the worker kept in the media library (source 'library', with a poster still) win; others come
// from the render job store (source 'job'), whose files expire a week after the render.
async function latestRenders(account,jobs=adRenderJobStore,links=adRenderLinks,media=adMediaStore){
 const out={};
 for(const j of (await jobs.list(account)).jobs){
  if(j.kind!=='mp4'||j.status!=='succeeded'||!j.campaign_id)continue;
  const f=(j.files||[]).find(x=>x.name==='ad.mp4');if(!f)continue;
  const at=j.finished_at||0,prev=out[j.campaign_id];if(prev&&prev.finished_at>=at)continue;
  out[j.campaign_id]={source:'job',job_id:j.job_id,finished_at:at,bytes:f.bytes,chunks:f.chunks,width:j.result?.width,height:j.result?.height,duration_sec:j.result?.duration_sec,quality:j.options?.quality};
 }
 for(const r of await links.list(account)){
  let poster='';
  try{const m=await media.read(account,r.media_id);if(m.status!=='ready')continue;if(m.preview&&m.preview.length<=60000)poster=m.preview;}catch{continue;} // deleted from the library: not kept any more
  out[r.campaign_id]={source:'library',media_id:r.media_id,job_id:r.job_id,finished_at:r.at,bytes:r.bytes,chunks:r.chunks,width:r.width,height:r.height,duration_sec:r.seconds,quality:r.quality,poster};
 }
 return out;
}
// Same split the render worker uses: med- ids come from the media library, the rest from the image library.
// clips:false returns a video's poster still, not the clip: whole clips are megabytes and would blow past the response size limit.
async function resolveProjectImages(account,project,images=adImageStore,media=adMediaStore){
 const ids=imageIdsOf(project),lib=ids.filter(i=>!i.startsWith('med-')),med=ids.filter(i=>i.startsWith('med-'));
 const a=lib.length?await images.resolve(account,lib):{images:{},missing:[]},b=med.length?await media.resolveImages(account,med,{clips:false}):{images:{},missing:[]};
 return {images:{...a.images,...b.images},missing:[...a.missing,...b.missing]};
}
export function createAdCampaignHandler({resolveAccount=resolveWorkspaceAccount,store=adCampaignStore,once=workspaceRequests}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   // This endpoint uses Nexus cookies; browser writes must come from this site.
   const origin=req.headers?.origin,host=req.headers?.host;
   if(origin && new URL(origin).host!==host)return res.status(403).json({error:'Open Ad Maker on this Nexus site.'});
   if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed.'});
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use application/json.'});
   const account=await resolveAccount(req);if(!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).some(k=>!['action','input','request_id'].includes(k)))return res.status(400).json({error:'Provide action, input, and request_id only.'});const {action,input={},request_id}=req.body;const operation={list:'ads',read:'ad',images:'ad',media_chunk:'ad',renders:'ad',render_chunk:'ad',save:'save_ad',design:'save_ad_design',preset:'apply_ad_design'}[action];if(!operation)return res.status(400).json({error:'Unknown ad action.'});if(!['media_chunk','renders','render_chunk'].includes(action))validateWorkspaceInput(operation,input);
   let data;
   if(action==='list')data=await store.list(account.id);
   else if(action==='read')data=await store.read(account.id,input.campaign_id);
   else if(action==='media_chunk'){if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['media_id','index'].includes(k))||!isMediaId(input.media_id)||!Number.isInteger(input.index))return res.status(400).json({error:'Provide media_id and index only.'});data=await adMediaStore.getChunk(account.id,input.media_id,input.index);}
   else if(action==='renders')data={renders:await latestRenders(account.id)};
   else if(action==='render_chunk'){if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['job_id','index'].includes(k))||typeof input.job_id!=='string'||!Number.isInteger(input.index))return res.status(400).json({error:'Provide job_id and index only.'});data=await adRenderJobStore.chunk(account.id,input.job_id,'ad.mp4',input.index);}
   else if(action==='images'){const record=await store.read(account.id,input.campaign_id);data=await resolveProjectImages(account.id,record.project);}
   else if(action==='design')data=await once(account.id,request_id,'save_ad_design',input,()=>store.saveDesign(account.id,input));
   else if(action==='preset')data=await once(account.id,request_id,'apply_ad_design',input,async()=>store.saveDesign(account.id,{campaign_id:input.campaign_id,baseline:input.baseline,design:await adDesignPreset(input.preset)}));
   else if(action==='save')data=await once(account.id,request_id,'save_ad',input,()=>store.save(account.id,input));
   else return res.status(400).json({error:'Unknown ad action.'});
   return res.status(200).json({ok:true,data});
  }catch(e){return res.status(e.status||400).json({error:e.status>=500?'Ad storage is temporarily unavailable. Reload before retrying.':e.message,code:e.code});}
 };
}
export default createAdCampaignHandler();

