// Owner creates/cancels/reads Forge lead jobs; only the actively paired Ally claims and finishes them.
// No model-supplied code, no outreach, no publishing.
import '../lib/store/installFetch.js';
import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {allyBridge} from '../lib/allyBridge.js';
import {forgeLeadJobQueue} from '../lib/forgeLeadJobs.js';

export const config={api:{bodyParser:{sizeLimit:'1200kb'}}};
const bad=(message,status)=>Object.assign(new Error(message),{status});
const DEVICE=['device_claim','device_heartbeat','device_complete','device_fail'];
function sameOrigin(req){
 const origin=req.headers?.origin,host=req.headers?.host;
 if(req.headers?.['sec-fetch-site']==='cross-site')return false;
 if(!origin)return true;
 try{return Boolean(host&&new URL(origin).host===host);}catch{return false;}
}
export function createForgeLeadJobsHandler({queue=forgeLeadJobQueue,bridge=allyBridge,resolveAccount=resolveWorkspaceAccount}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  try{
   if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Use GET or POST.'});
   if(!sameOrigin(req))return res.status(403).json({error:'Open Nexus Forge.'});
   if(req.method==='GET'){
    const owner=await resolveAccount(req);
    if(owner?.owner!==true)return res.status(403).json({error:'Owner only.'});
    return res.status(200).json({jobs:await queue.list(owner.id)});
   }
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON required.'});
   const body=req.body;
   if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({error:'Invalid job request.'});
   const {action,input={}}=body;
   if(!input||typeof input!=='object'||Array.isArray(input))throw bad('Invalid job fields.',400);
   const size=Buffer.byteLength(JSON.stringify(body));
   if(DEVICE.includes(action)){
    if(size>1000000)throw bad('Invalid job request.',400);
    const bearer=String(req.headers?.authorization||'').replace(/^Bearer /,'');
    const {owner,device_id}=await bridge.authorizeActiveDevice(bearer);
    const handlers={device_claim:()=>queue.claim(owner,device_id),device_heartbeat:()=>queue.heartbeat(owner,device_id,input),
     device_complete:()=>queue.complete(owner,device_id,input),device_fail:()=>queue.fail(owner,device_id,input)};
    const result=await handlers[action]();
    return res.status(200).json(action==='device_claim'?{job:result}:{result});
   }
   if(size>11000)throw bad('Invalid job request.',400);
   if(!req.headers?.origin)throw bad('Open Nexus Forge to submit a job.',403);
   const owner=await resolveAccount(req);
   if(owner?.owner!==true)return res.status(403).json({error:'Owner only.'});
   if(action==='create'){
    const status=await bridge.status(owner.id);
    if(!status.paired||!status.device_id)throw bad('Pair the Ally before searching.',409);
    return res.status(200).json({job:await queue.create(owner.id,status.device_id,input)});
   }
   if(action==='cancel')return res.status(200).json({job:await queue.cancel(owner.id,input.id)});
   if(action==='result')return res.status(200).json({result:await queue.getResult(owner.id,input.id)});
   throw bad('Unsupported action.',400);
  }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Forge lead queue unavailable.'});}
 };
}
export default createForgeLeadJobsHandler();
