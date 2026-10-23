import '../lib/store/installFetch.js';
import {researchStore} from '../lib/researchJobs.js';
// Public endpoint for the research page. Access is the secret link key; there are no accounts or cookies.
export function createResearchHandler({store=researchStore}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   const origin=req.headers?.origin,host=req.headers?.host;
   if(origin&&new URL(origin).host!==host)return res.status(403).json({error:'Open the page on this Nexus site.'});
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use application/json.'});
   const b=req.body;
   if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['action','key','input'].includes(k)))return res.status(400).json({error:'Provide action, key and input only.'});
   const {action,key,input={}}=b;
   if(action==='submit')return res.status(200).json({ok:true,data:await store.submit(key,input)});
   if(action==='status')return res.status(200).json({ok:true,data:await store.status(key,input)});
   return res.status(400).json({error:'Unknown action.'});
  }catch(e){
   const status=e.status||(e.name==='ZodError'?400:500);
   const message=e.name==='ZodError'?'Enter a competitor name or handle (2-120 characters).':status>=500?'Temporarily unavailable. Try again shortly.':e.message;
   return res.status(status).json({error:message,code:e.code});
  }
 };
}
export default createResearchHandler();
