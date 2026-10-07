import crypto from 'node:crypto';
import { nexusMessagesStore } from './nexusMessagesStore.js';
import { teamRunStore, TeamError } from './teamRuns.js';
import { createTeamRunner } from './teamRunner.js';
import { teamHandles } from '../public/team-mentions.js';
import { teamMissionIndex } from './teamMissionIndex.js';

export const AGENT_COLLABORATION_TOOLS = [
  {name:'list_specialists',description:'List your saved specialists and their @handles. Use these actual ids to ask another agent for help in the current conversation.',input_schema:{type:'object',properties:{}}},
  {name:'delegate_agent',description:'Ask a saved specialist for help in this same chat. Starts a visible durable assignment that continues in the background and pauses at the receiving agent’s existing change approvals. It does not mean the work is already finished. Share only task-relevant context. Mission workers cannot delegate further.',input_schema:{type:'object',properties:{agent_id:{type:'string'},task:{type:'string',description:'Concrete assignment with only the context needed, up to 3500 characters.'}},required:['agent_id','task']}},
];

export function createAgentDelegation({messages=nexusMessagesStore,runs=teamRunStore,missions=teamMissionIndex,id=()=>crypto.randomUUID()}={}) {
  const runner=createTeamRunner({messages,runs});
  return async function delegate(name,input,context) {
    const owner=context.userId;
    if(!owner || context.allowAgentDelegation===false)throw new TeamError('Agent delegation is unavailable in this run.');
    const current=await runner.group(owner,context.threadId || 'nex-main');
    const state=await messages.overview(owner),people=teamHandles(state.specialists);
    if(name==='list_specialists')return {agents:people.map(({id,name,handle,role,job})=>({id,name,handle,role,job}))};
    const target=people.find(person=>person.id===input.agent_id);
    if(!target)throw new TeamError('Choose an available saved specialist.');
    if(target.id===current.id)throw new TeamError('Ask another specialist, rather than delegating to yourself.');
    if(typeof input.task!=='string' || !input.task.trim() || input.task.length>3500)throw new TeamError('Give the specialist a task of up to 3,500 characters.');
    // A task's prose cannot smuggle in another assignment or @team. It is
    // data for this selected recipient, never a routing instruction.
    const task=input.task.replace(/(^|\s)@/gu,'$1＠');
    const run=await runs.create(owner,current.id,state.specialists,`@${target.handle} ${task}`,`agent-${id()}`,{includeNex:current.kind==='nex',replyTo:current.kind==='specialist'?state.specialists.find(person=>person.id===current.id):null,requester:context.agentName || 'Nex',teamMemberIds:current.kind==='group'?current.member_ids:null,autoStart:true});
    await missions.track(owner,current.id,run).catch(error=>console.error('Delegated mission tracking failed:',error.message));
    return {run_id:run.id,thread_id:current.id,state:run.state,agent:target.name,instruction:'Assignment started in this chat. It will continue in the background and pause only for an approval or blocker.'};
  };
}
export const delegateToAgent=createAgentDelegation();
