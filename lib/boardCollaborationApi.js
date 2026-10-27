import {boardCollaboration} from './boardCollaboration.js';
export function createCollaborationApi({store=boardCollaboration}={}){return async function route(req,res,access){
 const action=req.body?.action,isGet=req.method==='GET'&&req.query?.view==='collaborations';if(!isGet&&!(typeof action==='string'&&action.startsWith('collaboration_')))return false;
 if(!access?.owner&&!access?.internal){res.status(401).json({error:'Private Agent Board authentication required.'});return true;}
 res.setHeader('Cache-Control','private, no-store');const abort=new AbortController(),stop=()=>abort.abort();res.on?.('close',stop);
 try{
  if(isGet){res.status(200).json(req.query.session_id?await store.read({session_id:req.query.session_id}):{collaborations:await store.list()});return true;}
  if(req.method!=='POST'){res.status(405).json({error:'Use POST.'});return true;}
  if(Buffer.byteLength(JSON.stringify(req.body||{}))>24000){res.status(413).json({error:'The collaboration input is too large.'});return true;}
  const {action,...input}=req.body||{};let result;
  if(action==='collaboration_join'){
   if(input.wait_ms!==undefined&&(!Number.isInteger(input.wait_ms)||input.wait_ms<0||input.wait_ms>20000))throw Object.assign(Error('Use wait_ms from 0 to 20000.'),{status:400});
   result=await store.join(input);if(input.wait_ms&&result.joined)result={...result,...await store.wait({session_id:result.session.id,...result.membership,after_seq:result.session.seq,wait_ms:input.wait_ms},{signal:abort.signal})};
  }else if(action==='collaboration_read')result=await store.read(input);
  else if(action==='collaboration_list')result={collaborations:await store.list()};
  else if(action==='collaboration_wait')result=await store.wait(input,{signal:abort.signal});
  else if(action==='collaboration_update')result=await store.update(input);
  else if(action==='collaboration_owner_stop'){if(!access.owner)throw Object.assign(Error('Only Justin can stop a session from the board.'),{status:403});result=await store.stop(input);}
  else throw Object.assign(Error('Choose a supported collaboration action.'),{status:400});
  res.status(200).json(result);return true;
 }catch(error){if(abort.signal.aborted&&res.destroyed)return true;res.status(error.status||503).json({error:error.status?error.message:'Collaboration is unavailable. Retry with the same work key and client ID.'});return true;}
 finally{res.removeListener?.('close',stop);}
};}
export const routeCollaboration=createCollaborationApi();
