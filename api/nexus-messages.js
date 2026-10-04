import {getNexusOwner} from '../lib/nexusOwnerAuth.js';
import {nexusMessagesStore,SPECIALIST_ROLES,MESSAGE_SCOPES} from '../lib/nexusMessagesStore.js';

export function createNexusMessagesHandler({getOwner=getNexusOwner,store=nexusMessagesStore}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');
    const owner=await getOwner(req).catch(()=>null);if(!owner)return res.status(401).json({error:'Please sign in again'});
    try{
      if(req.method==='GET')return res.status(200).json({...await store.overview(owner.id),roles:SPECIALIST_ROLES,scopes:MESSAGE_SCOPES});
      if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
      const action=String(req.body?.action || '');
      if(action==='create_specialist')return res.status(201).json({specialist:await store.createSpecialist(owner.id,req.body)});
      if(action==='create_group')return res.status(201).json({group:await store.createGroup(owner.id,req.body)});
      if(action==='remove')return res.status(200).json({removed:await store.remove(owner.id,req.body?.type,req.body?.id)});
      return res.status(400).json({error:'Choose a supported Messages action'});
    }catch(error){
      const known=/^(Choose|You have reached|A valid)/u.test(error.message);return res.status(known?400:503).json({error:known?error.message:'Messages could not save that change. Please try again.'});
    }
  };
}
export default createNexusMessagesHandler();
