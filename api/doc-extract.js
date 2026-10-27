import '../lib/store/installFetch.js';
import {researchStore} from '../lib/researchJobs.js';
import {validateFiles,extractDocuments} from '../lib/docExtract.js';
// Public endpoint for Documents to Spreadsheet. Access is the wallet link key. Files are read in memory for this one request.
export function createDocExtractHandler({store=researchStore,extract=extractDocuments}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   const origin=req.headers?.origin,host=req.headers?.host;
   if(origin&&new URL(origin).host!==host)return res.status(403).json({error:'Open the page on this Nexus site.'});
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use application/json.'});
   const b=req.body;
   if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['key','fields','files'].includes(k)))return res.status(400).json({error:'Provide key, files and optional fields only.'});
   const files=validateFiles(b.files);
   const fields=typeof b.fields==='string'?b.fields.replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,300):'';
   const out=await store.runNow(b.key,'docs',fields?{fields}:{},()=>extract({files,fields}));
   return res.status(200).json({ok:true,data:out});
  }catch(e){
   const status=e.status||(e.name==='ZodError'?400:500);
   if(status>=500)console.error('doc-extract error:',e.message);
   return res.status(status).json({error:status>=500?'Temporarily unavailable. Try again shortly.':e.message,code:e.code,...(e.refunded?{refunded:true}:{})});
  }
 };
}
export default createDocExtractHandler();
