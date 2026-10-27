import '../lib/store/installFetch.js';
import {timingSafeEqual} from 'node:crypto';
import {researchStore} from '../lib/researchJobs.js';
export function createResearchSweepHandler({store=researchStore,secret=()=>process.env.CRON_SECRET}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET')return res.status(405).json({error:'Use GET.'});
    const expected=secret();const given=String(req.headers?.authorization||'');
    const want=Buffer.from('Bearer '+(expected||'')),got=Buffer.from(given);
    if(!expected||want.length!==got.length||!timingSafeEqual(want,got))return res.status(401).json({error:'Unauthorized.'});
    try{const result=await store.recover();return res.status(result.pending?503:200).json({ok:!result.pending,...result});}
    catch{return res.status(503).json({error:'Recovery will retry on the next sweep.'});}
  };
}
export default createResearchSweepHandler();
