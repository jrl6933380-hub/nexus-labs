import { teamMissionIndex } from '../lib/teamMissionIndex.js';
import { teamRunStore } from '../lib/teamRuns.js';
import { teamRunner } from '../lib/teamRunner.js';

const WORKING_STATES=new Set(['queued','running','stopping']);

function isAuthorized(req) {
  const secret=process.env.CRON_SECRET;
  return Boolean(secret) && req.headers?.authorization===`Bearer ${secret}`;
}

export function createTeamSweepHandler({ missions=teamMissionIndex, runs=teamRunStore, runner=teamRunner }={}) {
  return async function handler(req,res) {
    if(req.method!=='GET')return res.status(405).json({error:'Method Not Allowed'});
    if(!isAuthorized(req))return res.status(401).json({error:'Unauthorized'});
    try{
      const refs=await missions.list(100),eligible=refs.filter(ref=>WORKING_STATES.has(ref.state)),selected=eligible.slice(0,2),results=await Promise.allSettled(selected.map(async ref=>{
        let run=(await runs.list(ref.owner,ref.group_id)).find(item=>item.id===ref.run_id);
        if(!run){await missions.remove(ref.owner,ref.group_id,ref.run_id);return {run_id:ref.run_id,state:'missing'};}
        if(WORKING_STATES.has(run.state))await runner.execute(ref.owner,ref.group_id,run.id);
        run=(await runs.list(ref.owner,ref.group_id)).find(item=>item.id===ref.run_id) || null;
        await missions.track(ref.owner,ref.group_id,run);
        return {run_id:ref.run_id,state:run?.state || 'missing'};
      }));
      return res.status(200).json({checked:selected.length,waiting_for_owner:refs.length-eligible.length,remaining:Math.max(0,eligible.length-selected.length),missions:results.map((result,index)=>result.status==='fulfilled'?result.value:{run_id:selected[index]?.run_id,state:'error'})});
    }catch(error){console.error('team sweep failed:',error.message);return res.status(500).json({error:'Team sweep failed'});}
  };
}

export default createTeamSweepHandler();
