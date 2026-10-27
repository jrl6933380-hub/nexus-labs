import {getNexusOwner} from '../lib/nexusOwnerAuth.js';
import {createNexusLab} from '../lib/nexusLab.js';
import {ownerCapabilityCatalog} from './owner-capabilities.js';
import {listVaultItems} from '../lib/codeVault.js';
async function catalog(owner){
  const [installed,vault]=await Promise.all([ownerCapabilityCatalog({owner:owner.id}),listVaultItems()]);
  return [...installed.tools.map(t=>({id:`tool:${t.name}`,name:t.name,text:t.description||'',source:'Installed tool'})),...installed.skills.map(s=>({id:`skill:${s.name}`,name:s.name,text:s.description||'',source:s.source||'Installed skill'})),...(Array.isArray(vault)?vault:[]).map(v=>({id:`vault:${v.id||v.name}`,name:v.name,text:[v.purpose,v.when_to_use,...(v.tags||[])].filter(Boolean).join(' '),source:v.source||'Vault reference'}))];
}
export function createNexusLabHandler({authenticate=getNexusOwner,service=createNexusLab({catalog})}={}){return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
  try{
    const owner=await authenticate(req);if(!owner)return res.status(401).json({error:'Sign in to your Nexus owner account.'});
    if(req.method==='GET')return res.status(200).json(await service.overview(owner));
    const origin=req.headers?.origin,host=req.headers?.host;
    if(!origin||!host||new URL(origin).host!==host||!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(403).json({error:'Run this from Nexus Lab.'});
    if(Buffer.byteLength(JSON.stringify(req.body||{}))>130000)return res.status(413).json({error:'The input is too large.'});
    if(req.body?.action!=='run')return res.status(400).json({error:'Choose a supported Lab action.'});
    return res.status(200).json({run:await service.run(owner,req.body)});
  }catch(error){return res.status(error.status||503).json({error:error.status?error.message:'Nexus Lab is unavailable. Try again shortly.'});}
};}
export default createNexusLabHandler();
