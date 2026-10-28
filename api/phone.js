import '../lib/store/installFetch.js';
import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {phoneBridge} from '../lib/phoneBridge.js';
export const config={api:{bodyParser:{sizeLimit:'600kb'}}};
export function createPhoneHandler({bridge=phoneBridge,resolveAccount=resolveWorkspaceAccount}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use JSON.'});
   if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Cross-site requests refused.'});
   if(req.headers?.origin&&new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'Use the Nexus site.'});
   const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))return res.status(400).json({error:'Provide an object.'});
   const {action,...input}=b;
   const fields={pair:['code','label'],start:['session_id'],poll:['session_id','accessibility'],complete:['session_id','command_id','result'],disconnect:['session_id'],pair_code:[],status:[],stop:[],revoke:[]}[action];
   if(!fields||Object.keys(input).some(k=>!fields.includes(k)))return res.status(400).json({error:'Unsupported action or field.'});
   let out;
   if(action==='pair')out=await bridge.pair(input.code,input.label);
   else if(['start','poll','complete','disconnect'].includes(action)){
    const token=String(req.headers?.authorization||'').replace(/^Bearer /,'');
    if(action==='start')out=await bridge.start(token,input.session_id);
    if(action==='poll')out=await bridge.poll(token,input.session_id,input.accessibility);
    if(action==='complete')out=await bridge.complete(token,input.session_id,input.command_id,input.result);
    if(action==='disconnect')out=await bridge.disconnect(token,input.session_id);
   }else{
    const owner=await resolveAccount(req);if(owner.owner!==true)return res.status(403).json({error:'Nexus owner only.'});
    out=action==='pair_code'?await bridge.pairCode(owner.id):action==='status'?await bridge.status(owner.id):await bridge.stop(owner.id,action==='revoke');
   }
   return res.status(200).json(out);
  }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Phone bridge unavailable. Try again.'});}
 };
}
export default createPhoneHandler();
