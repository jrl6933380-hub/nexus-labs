import {getNexusOwner} from '../lib/nexusOwnerAuth.js';
import {privatePlatformAuthorized} from '../lib/privatePlatformAuth.js';
import {createWorkspaceOwnerKeyStore} from '../lib/workspaceOwnerKey.js';
export function createWorkspaceKeySetupHandler({getOwner=getNexusOwner,agentAuthorized=req=>privatePlatformAuthorized(req,{getOwner:async()=>null}),store=createWorkspaceOwnerKeyStore(),origin=process.env.SITE_URL || 'https://nexus-labs-sigma.vercel.app'}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
  try{
   if(req.method==='POST' && req.body?.action==='verify'){
    if(!await agentAuthorized(req))return res.status(401).json({error:'Private connector authentication required.'});
    return res.status(200).json({valid:await store.verify(req.body.key)});
   }
   const owner=await getOwner(req);if(!owner)return res.status(401).json({error:'Sign in to the private Nexus owner account first.'});
   if(req.method==='GET')return res.status(200).json(await store.status());
   if(req.headers?.origin!==new URL(origin).origin)return res.status(403).json({error:'Open setup on the Nexus owner site.'});
   if(!req.body || Object.keys(req.body).some(k=>!['action','request_id'].includes(k)) || !['create','rotate'].includes(req.body.action))return res.status(400).json({error:'Choose Create key or Replace key.'});
   return res.status(201).json(await store.create({request_id:req.body.request_id,rotate:req.body.action==='rotate'}));
  }catch(error){return res.status(error.status || 503).json({error:error.status && error.status<500?error.message:'Key setup is temporarily unavailable. No key has been displayed; check setup before retrying.'});}
 };
}
export default createWorkspaceKeySetupHandler();
