import '../lib/store/installFetch.js';
import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {isForgeManager} from '../lib/forgeRoles.js';
import {importForgeResearch} from '../lib/forgeResearchImport.js';
export const config={api:{bodyParser:{sizeLimit:'48kb'}}};
export function createForgeResearchHandler({resolveAccount=resolveWorkspaceAccount,isManager=isForgeManager,importLeads=importForgeResearch}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Use GET or POST.'});
   // Import is a human session action. Device/agent bearer tokens cannot approve it.
   if(req.headers?.authorization)return res.status(403).json({error:'Open the owner review page to import leads.'});
   const account=await resolveAccount(req);
   if(account?.owner!==true||!await isManager(account.workbenchUserId))return res.status(403).json({error:'Nexus owner and Forge manager access required.'});
   if(req.method==='GET')return res.status(200).json({ready:true});
   let origin;try{origin=new URL(req.headers?.origin);}catch{}
   if(!origin||origin.protocol!=='https:'||origin.host!==req.headers?.host)return res.status(403).json({error:'Import from the signed-in Forge review page.'});
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON required.'});
   if(!req.body||Buffer.byteLength(JSON.stringify(req.body))>45000)return res.status(413).json({error:'Research batch is too large.'});
   const result=await importLeads(account.id,account.workbenchUserId,req.body);
   return res.status(200).json(result);
  }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Import unavailable. Keep this review open and retry the same request.'});}
 };
}
export default createForgeResearchHandler();
