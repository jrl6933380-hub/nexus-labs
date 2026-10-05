import {getNexusOwner} from '../lib/nexusOwnerAuth.js';
import {nexusMessagesStore,SPECIALIST_ROLES,MESSAGE_SCOPES} from '../lib/nexusMessagesStore.js';
import {waitUntil} from '@vercel/functions';
import {createTeamMessagesHandler} from '../lib/teamMessagesHandler.js';
import {teamRunStore} from '../lib/teamRuns.js';

export const maxDuration = 300;

export function createNexusMessagesHandler({getOwner=getNexusOwner,store=nexusMessagesStore,team=createTeamMessagesHandler({schedule:waitUntil})}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');
    const owner=await getOwner(req).catch(()=>null);if(!owner)return res.status(401).json({error:'Please sign in again'});
    try{
      if((req.method==='GET' && (req.query?.group_id || req.query?.thread_id)) || (req.method==='POST' && String(req.body?.action || '').startsWith('team_')))return await team(req,res,owner);
      if(req.method==='GET'){
        const state=await store.overview(owner.id),team_status={},specialist_status={},specialist_stamps={};
        const labels={planned:'Plan ready',queued:'Up next',running:'Working',needs_approval:'Needs you',blocked:'Needs attention',completed:'Result ready',stopping:'Stopping'};
        await Promise.all(state.groups.map(async group=>{try{
          const [run]=await teamRunStore.list(owner.id,group.id);if(run && labels[run.state])team_status[group.id]=labels[run.state];
          if(run && run.state!=='cancelled')for(const step of run.steps){
            const label={working:'Working',returned:'Result ready',needs_approval:'Needs you',blocked:'Needs attention',interrupted:'Interrupted'}[step.state];
            if(step.member_id && label && (!specialist_stamps[step.member_id] || run.updated_at>specialist_stamps[step.member_id])){specialist_status[step.member_id]=label;specialist_stamps[step.member_id]=run.updated_at;}
          }
        }catch{}}));
        return res.status(200).json({...state,team_status,specialist_status,roles:SPECIALIST_ROLES,scopes:MESSAGE_SCOPES});
      }
      if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
      const action=String(req.body?.action || '');
      if(action==='create_specialist')return res.status(201).json({specialist:await store.createSpecialist(owner.id,req.body)});
      if(action==='create_group')return res.status(201).json({group:await store.createGroup(owner.id,req.body)});
      if(action==='set_group_nex')return res.status(200).json({group:await store.setGroupNex(owner.id,req.body?.group_id,req.body?.include_nex)});
      if(action==='set_pinned_systems')return res.status(200).json({pinned_system_ids:await store.setPinnedSystems(owner.id,req.body?.pinned_system_ids)});
      if(action==='remove')return res.status(200).json({removed:await store.remove(owner.id,req.body?.type,req.body?.id)});
      return res.status(400).json({error:'Choose a supported Messages action'});
    }catch(error){
      if(error.status)return res.status(error.status).json({error:error.message});
      const known=/^(Choose|You have reached|A valid)/u.test(error.message);return res.status(known?400:503).json({error:known?error.message:'Messages could not save that change. Please try again.'});
    }
  };
}
export default createNexusMessagesHandler();
