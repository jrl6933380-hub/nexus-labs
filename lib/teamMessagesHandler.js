import { teamRunStore, TeamError } from './teamRuns.js';
import { teamRunner } from './teamRunner.js';
import { teamMissionIndex } from './teamMissionIndex.js';

function publicRun(run) {
  return {...run,steps:run.steps.map(({token,lease_until,...step})=>step)};
}
export function createTeamMessagesHandler({ runs=teamRunStore, runner=teamRunner, missions=teamMissionIndex, schedule=()=>{}, persistProjects=async()=>{}, checkCapacity=async()=>{} }={}) {
  return async function handle(req,res,owner) {
    const groupId = req.method==='GET'?(req.query?.thread_id || req.query?.group_id):(req.body?.thread_id || req.body?.group_id);
    const current = await runner.group(owner.id,groupId);
    if(req.method==='GET'){
      const saved=await runs.list(owner.id,groupId);
      await persistProjects(req,groupId,saved).catch(error=>console.error('Project draft save failed:',error.message));
      return res.status(200).json({group:current,runs:saved.map(publicRun)});
    }
    const {action,run_id,step_id,approval_id,message,request_id}=req.body || {};
    let run;
    if(action==='team_create'){const replay=(await runs.list(owner.id,groupId)).find(item=>item.request_id===request_id);if(!replay)await checkCapacity(req,message,current);run=await runs.create(owner.id,groupId,current.available_members || current.members,message,request_id,{includeNex:current.include_nex !== false,teamMemberIds:current.kind==='group'?current.member_ids:null,autoStart:true});}

    else if(['team_start','team_approve_step','team_retry','team_cancel','team_resolve_approval'].includes(action))run=await runs.act(owner.id,groupId,run_id,action.slice(5),step_id,approval_id);
    else if(action==='team_advance')run=(await runs.list(owner.id,groupId)).find(item=>item.id===run_id);
    else throw new TeamError('Choose a supported team action.');
    if(!run)throw new TeamError('That team task is no longer available.',404);
    await missions.track(owner.id,groupId,run).catch(error=>console.error('Team mission tracking failed:',error.message));
    if(['queued','running','stopping'].includes(run.state)) {
      // The runner claims under a lock before doing any model work. Duplicate
      // requests see the active lease and never execute the assignment twice.
      const scheduled=schedule(async()=>{
        const started=Date.now();
        // Continue short read-only handoffs even if the tab closes. Leave
        // enough request lifetime for one final bounded specialist call.
        do {
          if(!await runner.execute(owner.id,groupId,run.id))break;
          const saved=(await runs.list(owner.id,groupId)).find(item=>item.id===run.id);
          if(saved)await persistProjects(req,groupId,[saved]).catch(error=>console.error('Project draft save failed:',error.message));
          if(saved?.state!=='queued' || Date.now()-started>60000)break;
        }while(true);
      });
      scheduled?.catch?.(error=>console.error('Team worker checkpoint failed:',error.message));
    }
    return res.status(200).json({run:publicRun(run)});
  };
}
