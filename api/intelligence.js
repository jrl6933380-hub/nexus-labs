import { createIntelligence, intelligenceBrief } from '../lib/intelligence.js';

export const config = {maxDuration:60};
export function createIntelligenceHandler({service=createIntelligence(),authenticate=async req=>(await import('../lib/roomAuth.js')).getRequestUser(req)}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      if(!['GET','POST','PATCH','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, PATCH, DELETE');return res.status(405).json({error:'Method not allowed.'});}
      if(req.method!=='GET'){
        const origin=req.headers?.origin, host=req.headers?.host;
        if(!origin || !host || new URL(origin).host!==host || !/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(403).json({error:'Use the Intelligence app to make this change.'});
        if(Buffer.byteLength(JSON.stringify(req.body||{}))>12000)return res.status(413).json({error:'Request too large.'});
      }
      const owner=await authenticate(req);if(!owner)return res.status(401).json({error:'Sign in to Nexus / Intelligence.'});
      const input=req.body||{};
      if(req.method==='GET'){
        const state=await service.overview(owner);
        return res.status(200).json(req.query?.format==='brief'?{brief:intelligenceBrief(state.competitors)}:state);
      }
      if(req.method==='POST' && input.action==='scan')return res.status(200).json(await service.scan(owner,input));
      if(req.method==='POST' && input.action==='add')return res.status(201).json({competitor:await service.add(owner,input)});
      if(req.method==='PATCH')return res.status(200).json({competitor:await service.annotate(owner,input)});
      if(req.method==='DELETE')return res.status(200).json(await service.remove(owner,input));
      return res.status(400).json({error:'Unknown Intelligence action.'});
    }catch(error){console.error('intelligence:',error.code||error.status||'request_failed');const status=error.status||503;return res.status(status).json({error:error.status?error.message:'Intelligence is temporarily unavailable. Please try again.'});}
  };
}
export default createIntelligenceHandler();
