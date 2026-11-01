import '../lib/store/installFetch.js';
import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {allyBridge} from '../lib/allyBridge.js';
export const config={api:{bodyParser:{sizeLimit:'600kb'}}};
export function createAllyHandler({bridge=allyBridge,resolveAccount=resolveWorkspaceAccount}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try {
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use JSON.'});
   if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Cross-site requests refused.'});
   if(req.headers?.origin&&new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'Use Nexus owner page.'});
   const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))return res.status(400).json({error:'Object required.'});
   const {action,...input}=b;
   const fields={pair:['code','label'],start:['session_id'],poll:['session_id'],complete_screen:['session_id','command_id','image_base64'],complete_command:['session_id','command_id','result'],disconnect:['session_id'],screen:[],screen_result:['command_id'],command:['command'],command_result:['command_id'],pair_code:[],status:[],stop:[],revoke:[]}[action];
   if(!fields||Object.keys(input).some(k=>!fields.includes(k)))return res.status(400).json({error:'Unsupported action or fields.'});
   let out;
   if(action==='pair')out=await bridge.pair(input.code,input.label);
   else if(['start','poll','disconnect','complete_screen','complete_command'].includes(action)){
    const token=String(req.headers?.authorization||'').replace(/^Bearer /,'');
    if(action==='start')out=await bridge.start(token,input.session_id);
    if(action==='poll')out=await bridge.poll(token,input.session_id);
    if(action==='disconnect')out=await bridge.disconnect(token,input.session_id);
    if(action==='complete_screen')out=await bridge.completeScreen(token,input.session_id,input.command_id,input.image_base64);
    if(action==='complete_command')out=await bridge.completeCommand(token,input.session_id,input.command_id,input.result);
   }else{
    const owner=await resolveAccount(req);
    if(owner.owner!==true)return res.status(403).json({error:'Owner only.'});
    out=action==='pair_code'?await bridge.pairCode(owner.id):action==='status'?await bridge.status(owner.id):action==='screen'?await bridge.requestScreen(owner.id):action==='screen_result'?await bridge.screenResult(owner.id,input.command_id):action==='command'?await bridge.enqueue(owner.id,input.command):action==='command_result'?await bridge.commandResult(owner.id,input.command_id):await bridge.stop(owner.id,action==='revoke');
   }
   return res.status(200).json(out);
  }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Ally service unavailable.'});}
 };
}
export default createAllyHandler();
