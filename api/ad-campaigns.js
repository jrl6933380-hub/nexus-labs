import {resolveWorkspaceAccount,validateWorkspaceInput} from '../lib/workspaceConnector.js';
import {adCampaignStore} from '../lib/adCampaigns.js';
import {workspaceRequests} from '../lib/workspaceRequests.js';
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
   const account=await resolveAccount(req);if(!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).some(k=>!['action','input','request_id'].includes(k)))return res.status(400).json({error:'Provide action, input, and request_id only.'});const {action,input={},request_id}=req.body;const operation={list:'ads',read:'ad',save:'save_ad'}[action];if(!operation)return res.status(400).json({error:'Unknown ad action.'});validateWorkspaceInput(operation,input);
   let data;
   if(action==='list')data=await store.list(account.id);
   else if(action==='read')data=await store.read(account.id,input.campaign_id);
   else if(action==='save')data=await once(account.id,request_id,'save_ad',input,()=>store.save(account.id,input));
   else return res.status(400).json({error:'Unknown ad action.'});
   return res.status(200).json({ok:true,data});
  }catch(e){return res.status(e.status||400).json({error:e.status>=500?'Ad storage is temporarily unavailable. Reload before retrying.':e.message,code:e.code});}
 };
}
export default createAdCampaignHandler();
