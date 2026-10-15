import {getRequestUser} from '../lib/roomAuth.js';
import {customerWorkspaceAccount} from '../lib/workspaceAccount.js';
import {getNexusOwner} from '../lib/nexusOwnerAuth.js';
import {workspaceOAuth,WORKSPACE_ORIGIN} from '../lib/workspaceOAuth.js';
export function createWorkspaceConsentHandler({getOwner=getNexusOwner,getUser=getRequestUser,provider=workspaceOAuth}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
  try{const owner=await getOwner(req),username=owner?null:await getUser(req);
   const account=owner || (username?customerWorkspaceAccount(username):null);
   if(!account)return res.status(401).json({error:'Sign in to your Nexus account to connect your workspace.'});
   if(req.method==='GET')return res.status(200).json(await provider.pending(req.query?.request,account));
   if(req.headers?.origin!==WORKSPACE_ORIGIN)return res.status(403).json({error:'Approve only from the Nexus sign-in page.'});
   const body=req.body;if(!body || Object.keys(body).some(k=>!['request','csrf','decision'].includes(k)))return res.status(400).json({error:'Invalid approval.'});
   return res.status(200).json(await provider.consent(body,account));
  }catch(error){return res.status(error.errorCode==='invalid_request'?400:503).json({error:error.errorCode==='invalid_request'?error.message:'Connection approval is temporarily unavailable.'});}
 };
}
export default createWorkspaceConsentHandler();
