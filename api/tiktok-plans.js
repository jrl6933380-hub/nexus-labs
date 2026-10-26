import '../lib/store/installFetch.js';
import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {tiktokPlanStore} from '../lib/tiktokPlans.js';
import {workspaceRequests} from '../lib/workspaceRequests.js';
// Browser endpoint for the TikTok planner page. Owner only; same cookies and origin rules as /api/ad-campaigns.
export function createTikTokPlansHandler({resolveAccount=resolveWorkspaceAccount,store=tiktokPlanStore,once=workspaceRequests}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   const origin=req.headers?.origin,host=req.headers?.host;
   if(origin && new URL(origin).host!==host)return res.status(403).json({error:'Open the planner on this Nexus site.'});
   if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed.'});
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use application/json.'});
   const account=await resolveAccount(req);
   if(account.owner!==true)return res.status(403).json({error:'The TikTok planner is only available to the Nexus owner.'});
   const body=req.body;
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','input','request_id'].includes(k)))return res.status(400).json({error:'Provide action, input, and request_id only.'});
   const {action,input={},request_id}=body;
   const writes={save_campaign:'saveCampaign',save_video:'saveVideo',save_account:'saveAccount',delete_video:'deleteVideo',delete_campaign:'deleteCampaign',build_ad:'buildAd'};
   let data;
   if(action==='overview')data=await store.overview(account.id);
   else if(action==='scope')data=await store.scope(account.id,input);
   else if(writes[action])data=await once(account.id,request_id,'tiktok_'+action,input,()=>store[writes[action]](account.id,input));
   else return res.status(400).json({error:'Unknown planner action.'});
   return res.status(200).json({ok:true,data});
  }catch(e){
   const status=e.status||(e.name==='ZodError'?400:500);
   const message=e.name==='ZodError'?e.issues.slice(0,3).map(i=>`${i.path.join('.')||'input'}: ${i.message}`).join('; '):status>=500?'The planner is temporarily unavailable. Reload before retrying.':e.message;
   return res.status(status).json({error:message,code:e.code});
  }
 };
}
export default createTikTokPlansHandler();
