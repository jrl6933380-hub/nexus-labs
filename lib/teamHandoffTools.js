import {teamRunStore} from './teamRuns.js';
import {specialistResultText} from '../public/chat-visual.js';
export const TEAM_HANDOFF_TOOL={name:'read_team_handoff',description:'Read the complete returned teammate output from this same saved team assignment. Use the step_id from a truncated handoff. Read-only, owner and mission scoped; never expands permissions.',input_schema:{type:'object',properties:{step_id:{type:'string'}},required:['step_id']}};
export async function readTeamHandoff(input,context,{runs=teamRunStore}={}){
 if(!context.userId || !context.teamGroupId || !context.teamRunId)throw new Error('This tool is available only inside the current saved team assignment.');
 const run=(await runs.list(context.userId,context.teamGroupId)).find(r=>r.id===context.teamRunId);
 const step=run?.steps.find(s=>s.id===input.step_id && s.state==='returned');
 if(!step)throw new Error('That completed handoff is not part of this assignment.');
 return {step_id:step.id,name:step.name,role:step.role,result:specialistResultText(step.role,step.full_result || step.result),saved_project:step.saved_project || null,evidence:step.evidence || null};
}
