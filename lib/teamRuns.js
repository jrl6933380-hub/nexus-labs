import crypto from 'node:crypto';
import { parseTeamMentions } from '../public/team-mentions.js';

const TTL = 60 * 60 * 24 * 30;
export const WORKER_LEASE_MS = 330_000;
const RELEASE = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
const SAVE = "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]) redis.call('DEL',KEYS[1]) return 1";
export class TeamError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function key(owner, group) {
  if (!/^[a-z0-9_-]{3,64}$/u.test(String(owner).toLowerCase()) || !/^group-[a-zA-Z0-9_-]{3,64}$/u.test(String(group))) throw new TeamError('Choose a valid group.');
  return `nexus:team:${String(owner).toLowerCase()}:${group}:v1`;
}
export async function teamCommand(parts) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new TeamError('Team storage is unavailable. Try again shortly.', 503);
  const response = await fetch(process.env.KV_REST_API_URL, { method:'POST', headers:{Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'}, body:JSON.stringify(parts), signal:AbortSignal.timeout(10_000) });
  const data = await response.json();
  if (!response.ok || data.error) throw new TeamError('Team storage is unavailable. Try again shortly.', 503);
  return data.result;
}
export function createTeamRunStore({ command = teamCommand, now = Date.now, id = () => crypto.randomUUID() } = {}) {
  async function list(owner, group) { const raw = await command(['GET', key(owner, group)]); return raw ? JSON.parse(raw) : []; }
  async function change(owner, group, update) {
    const base = key(owner, group), token = id(), lock = `${base}:lock`;
    if (await command(['SET', lock, token, 'NX', 'EX', 15]) !== 'OK') throw new TeamError('The team is saving another update. Try again.', 409);
    try {
      const runs = await list(owner, group), result = await update(runs);
      if(Number(await command(['EVAL', SAVE, 2, lock, base, token, JSON.stringify(runs.slice(0, 12)), TTL]))!==1)throw new TeamError('The team update timed out. Refresh before trying again.',409);
      return result;
    } finally { await command(['EVAL', RELEASE, 1, lock, token]); }
  }
  function find(runs, runId) { const run = runs.find(item => item.id === runId); if (!run) throw new TeamError('That team task is no longer available.', 404); return run; }
  function event(run, message, member_id = null) { run.updated_at = now(); run.events.push({ at:now(), message, member_id }); run.events = run.events.slice(-32); }
  return {
    list,
    async create(owner, group, members, message, requestId) {
      if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw new TeamError('Give the team a task of up to 4,000 characters.');
      if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(String(requestId || ''))) throw new TeamError('A task request id is required.');
      return change(owner, group, runs => {
        const replay = runs.find(run => run.request_id === requestId); if (replay) return replay;
        if (runs.some(run => !['completed','cancelled'].includes(run.state))) throw new TeamError('Finish or cancel this group’s current task first.', 409);
        let mentions;try{mentions=parseTeamMentions(message,members);}catch(error){throw new TeamError(error.message);}
        const assigned = mentions.some(mention => mention.all) || !mentions.length ? members : members.filter(member => mentions.some(mention => mention.member_id === member.id));
        if (!assigned.length) throw new TeamError('Choose at least one teammate.');
        const goal = message.replace(/(^|\s)@(?:"[^"]+"|[\p{L}\p{N}_-]+)/gu, '$1').trim();
        if (!goal) throw new TeamError('Tell your teammates what to do after the mention.');
        // Explicit mention order is a handoff order. @team defaults to research before builders.
        const ordered = mentions.length && !mentions.some(m => m.all) ? [...assigned].sort((a,b) => mentions.findIndex(m=>m.member_id===a.id) - mentions.findIndex(m=>m.member_id===b.id)) : [...assigned].sort((a,b) => (a.role==='research'?0:a.role==='build'?2:1) - (b.role==='research'?0:b.role==='build'?2:1));
        const steps = ordered.map(member => ({ id:id(), member_id:member.id, name:member.name, role:member.role, job:member.job, scopes:[...member.scopes],
          instruction:mentions.filter(m=>m.member_id===member.id).map(m=>m.instruction).filter(Boolean).join('\n') || goal,
          requires_approval:member.role!=='research' && member.scopes.some(scope=>scope!=='conversation'), state:'queued', attempts:0 }));
        steps.push({ id:id(), member_id:null, name:'Nex', role:'review', instruction:'Review the saved specialist results against the original task. Summarize what was produced, actual evidence, remaining issues, and the next decision. Do not claim publication or tests without tool evidence.', requires_approval:false, state:'queued', attempts:0 });
        const run = { id:`mission-${id()}`, request_id:requestId, group_id:group, message, goal, state:'planned', created_at:now(), updated_at:now(), steps, events:[] };
        event(run, 'Nex prepared the assignments. Review the plan to begin.'); runs.unshift(run); return run;
      });
    },
    async act(owner, group, runId, action, stepId) {
      return change(owner, group, runs => {
        const run = find(runs, runId);
        if (action === 'cancel') { if (run.state !== 'completed') { run.state = run.steps.some(step=>step.state==='working') ? 'stopping' : 'cancelled'; event(run, run.state==='stopping'?'Stopping after the current assignment.':'Task cancelled.'); } return run; }
        if (action === 'start') { if (run.state === 'planned') { run.state='queued'; event(run,'Plan approved. The team can begin.'); } return run; }
        if (action === 'approve_step') {
          const step = run.steps.find(item=>item.id===stepId);
          if (!step || run.state!=='needs_approval' || step.state!=='needs_approval') throw new TeamError('That assignment is not waiting for approval.',409);
          step.approved_at=now();step.state='queued';run.state='queued';event(run,`${step.name}’s assignment approved.`,step.member_id);return run;
        }
        if (action === 'retry') {
          const step=run.steps.find(item=>item.id===stepId);
          if (run.state!=='blocked' || !step || !['blocked','interrupted'].includes(step.state)) throw new TeamError('That assignment cannot be retried now.',409);
          if (step.attempts>=3) throw new TeamError('This assignment reached its retry limit. Start a revised task.');
          step.previous_result=step.result?.slice(0,8000) || null;step.state='queued';step.error=null;step.result=null;step.pending_approval=null;run.state='queued';event(run,`${step.name} will retry this assignment.`,step.member_id);return run;
        }
        throw new TeamError('Choose a supported team action.');
      });
    },
    async claim(owner, group, runId) {
      return change(owner, group, runs => {
        const run=find(runs,runId), working=run.steps.find(step=>step.state==='working');
        if (working) {
          if (working.lease_until<=now()) { working.state='interrupted';working.error='The worker was interrupted. Review any partial changes before retrying.';run.state=run.state==='stopping'?'cancelled':'blocked';event(run,working.error,working.member_id); }
          return null;
        }
        if (!['queued','running'].includes(run.state)) return null;
        const step=run.steps.find(item=>item.state!=='returned');
        if (!step) { run.state='completed';event(run,'All results are saved and ready for your review.');return null; }
        if (step.requires_approval && !step.approved_at) {step.state='needs_approval';run.state='needs_approval';event(run,`${step.name} is waiting for your approval before making changes.`,step.member_id);return null;}
        step.state='working';step.attempts++;step.token=id();step.started_at=now();step.lease_until=now()+WORKER_LEASE_MS;run.state='running';event(run,`${step.name} started their assignment.`,step.member_id);
        return { run:structuredClone(run), step:structuredClone(step) };
      });
    },
    async settle(owner, group, runId, stepId, token, output) {
      return change(owner, group, runs => {
        const run=find(runs,runId),step=run.steps.find(item=>item.id===stepId);
        if (!step || step.state!=='working' || step.token!==token || step.lease_until<=now()) return run;
        Object.assign(step,output,{finished_at:now()});delete step.token;delete step.lease_until;
        if(run.state==='stopping')run.state='cancelled';
        else if(step.state==='blocked')run.state='blocked';
        else run.state=run.steps.every(item=>item.state==='returned')?'completed':'queued';
        event(run,step.state==='returned'?`${step.name} returned a result${run.state==='queued'?' and passed it to the next teammate':''}.`:`${step.name} needs attention.`,step.member_id);return run;
      });
    },
    async progress(owner,group,runId,stepId,token,stage){
      return change(owner,group,runs=>{
        const run=find(runs,runId),step=run.steps.find(item=>item.id===stepId);
        if(step?.state!=='working' || step.token!==token || step.lease_until<=now())return;
        step.activity=String(stage.label || stage.tool || 'Working on the assignment').replace(/\s+/gu,' ').slice(0,120);run.updated_at=now();
      });
    },
  };
}
export const teamRunStore = createTeamRunStore();
