import { teamRunStore, TeamError } from './teamRuns.js';
import { teamRunner } from './teamRunner.js';

function publicRun(run) {
  return {...run,steps:run.steps.map(({token,lease_until,...step})=>step)};
}
export function createTeamMessagesHandler({ runs=teamRunStore, runner=teamRunner, schedule }={}) {
  return async function handle(req,res,owner) {
    const groupId = req.method==='GET'?req.query?.group_id:req.body?.group_id;
    const current = await runner.group(owner.id,groupId);
    if(req.method==='GET')return res.status(200).json({group:current,runs:(await runs.list(owner.id,groupId)).map(publicRun)});
    const {action,run_id,step_id,message,request_id}=req.body || {};
    let run;
    if(action==='team_create')run=await runs.create(owner.id,groupId,current.members,message,request_id);
    else if(['team_start','team_approve_step','team_retry','team_cancel'].includes(action))run=await runs.act(owner.id,groupId,run_id,action.slice(5),step_id);
    else if(action==='team_advance')run=(await runs.list(owner.id,groupId)).find(item=>item.id===run_id);
    else throw new TeamError('Choose a supported team action.');
    if(!run)throw new TeamError('That team task is no longer available.',404);
    if(['queued','running','stopping'].includes(run.state)) {
      // The runner claims under a lock before doing any model work. Duplicate
      // requests see the active lease and never execute the assignment twice.
      schedule((async()=>{
        const started=Date.now();
        // Continue short read-only handoffs even if the tab closes. Leave
        // enough request lifetime for one final bounded specialist call.
        do {
          if(!await runner.execute(owner.id,groupId,run.id))break;
          const saved=(await runs.list(owner.id,groupId)).find(item=>item.id===run.id);
          if(saved?.state!=='queued' || Date.now()-started>60000)break;
        }while(true);
      })().catch(error=>console.error('Team worker checkpoint failed:',error.message)));
    }
    return res.status(200).json({run:publicRun(run)});
  };
}
