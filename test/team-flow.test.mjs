import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeamRunStore,WORKER_LEASE_MS} from '../lib/teamRuns.js';
import {createTeamRunner} from '../lib/teamRunner.js';
import {createTeamMessagesHandler} from '../lib/teamMessagesHandler.js';
import {parseTeamMentions,teamHandles} from '../public/team-mentions.js';
import {createAgentDelegation} from '../lib/agentDelegation.js';
import {chatVisualDocument} from '../public/chat-visual.js';
import {buildConversationAccessPolicy} from '../lib/nexBrain.js';

const members=[{id:'agent-maya',name:'Maya',role:'research',job:'Research launch ideas',scopes:['conversation']},{id:'agent-atlas',name:'Atlas',role:'build',job:'Build projects',scopes:['conversation','projects']}];
function fixture(){
  let clock=1000,sequence=0;const data=new Map();
  const command=async([verb,key,...args])=>{
    if(verb==='GET')return data.get(key) || null;
    if(verb==='SET'){if(args.includes('NX') && data.has(key))return null;data.set(key,args[0]);return 'OK';}
    if(verb==='EVAL'){
      const [count,lock,...rest]=args;
      if(Number(count)===1){if(data.get(lock)===rest[0]){data.delete(lock);return 1;}return 0;}
      const [base,token,value]=rest;if(data.get(lock)!==token)return 0;data.set(base,value);data.delete(lock);return 1;
    }
    throw new Error('Unexpected Redis command '+verb);
  };
  return {runs:createTeamRunStore({command,now:()=>clock,id:()=>`test-${++sequence}`}),tick:()=>{clock+=WORKER_LEASE_MS+1;},advance:milliseconds=>{clock+=milliseconds;},now:()=>clock};
}
const create=(runs,owner='justin',text='@Maya research launch ideas @Atlas build a page',request='request-one')=>runs.create(owner,'group-launch',members,text,request);
const res=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});

test('mentions resolve saved group members, quoted names and unique duplicate handles',()=>{
  assert.deepEqual(parseTeamMentions('Email me a@maya.com',members),[]);
  assert.deepEqual(parseTeamMentions('@Maya compare options @Atlas build',members).map(m=>[m.member_id,m.instruction]),[['agent-maya','compare options'],['agent-atlas','build']]);
  const duplicate=[...members,{...members[0],id:'agent-other'}];assert.throws(()=>parseTeamMentions('@Maya go',duplicate),/unique/);
  assert.equal(parseTeamMentions(`@${teamHandles(duplicate)[0].handle} go`,duplicate)[0].member_id,'agent-maya');
  assert.throws(()=>parseTeamMentions('@outsider go',members),/not here/);
  assert.equal(parseTeamMentions('@"Mary Jane" research',[{...members[0],name:'Mary Jane'}])[0].instruction,'research');
  assert.equal(parseTeamMentions('@team compare',members)[0].instruction,'compare');
});
test('core specialist names have direct mention handles',()=>{
  const core=[
    {id:'agent-core-atlas',name:'Atlas',role:'research'},
    {id:'agent-core-mason',name:'Mason',role:'build'},
    {id:'agent-core-vida',name:'Vida',role:'life'},
    {id:'agent-core-vera',name:'Vera',role:'review'},
  ];
  assert.deepEqual(teamHandles(core).map(item=>item.handle),['atlas','mason','vida','vera']);
  assert.deepEqual(parseTeamMentions('@Atlas investigate @Mason build @Vida plan @Vera verify',core).map(item=>item.member_id),core.map(item=>item.id));
});
test('review specialists stay read-only and do not request write approval',async()=>{
  const {runs}=fixture(),reviewer={id:'agent-core-vera',name:'Vera',role:'review',job:'Verify work',scopes:['conversation','projects']};
  const run=await runs.create('justin','nex-main',[reviewer],'@Vera verify this','request-reviewer');
  assert.equal(run.steps[0].requires_approval,false);
  const calls=[];
  const runner=createTeamRunner({runs,messages:{overview:async()=>({groups:[],specialists:[reviewer]})},mode:async()=>({mode:'engaged'}),history:async()=>null,ask:async(...args)=>{calls.push(args);return {reply:'Reviewed',provider:'gateway'};}});
  await runs.act('justin','nex-main',run.id,'start');await runner.execute('justin','nex-main',run.id);
  assert.equal(calls[0][3].conversation.execution_mode,'read_only');
});
test('mission creation is idempotent, owner scoped and prevents overlapping group writes',async()=>{
  const {runs}=fixture(),first=await create(runs);assert.equal((await create(runs)).id,first.id);
  await assert.rejects(create(runs,'justin','@Atlas other','request-two'),/current task/);
  assert.equal((await runs.list('another','group-launch')).length,0);
  const other=await create(runs,'another');assert.notEqual(other.id,first.id);
  await assert.rejects(runs.claim('another','group-launch',first.id),/no longer/);
  assert.equal(first.steps.at(-1).role,'review');assert.equal(first.steps[1].requires_approval,true);
});
test('separate calls pass actual research to builder, pause for approval, then review',async()=>{
  const {runs}=fixture(),calls=[],currentMembers=structuredClone(members);
  const runner=createTeamRunner({runs,messages:{overview:async()=>({groups:[{id:'group-launch',member_ids:members.map(m=>m.id)}],specialists:currentMembers})},mode:async()=>({mode:'engaged'}),history:async()=>({messages:[{role:'user',content:'Our launch is a simple site.'}]}),ask:async(prompt,h,t,context)=>{calls.push({prompt,h,context});return {reply:calls.length===1?'Research finding: local gardening.':calls.length===2?'Draft PR prepared.':'Reviewed the returned draft.',provider:'gateway',model:'test-model',completionReceipt:{status:'not_required',observed:[]}};}});
  const run=await create(runs);await runner.execute('justin','group-launch',run.id);assert.equal(calls.length,0,'unapproved plans do no work');
  await runs.act('justin','group-launch',run.id,'start');await runner.execute('justin','group-launch',run.id);
  assert.equal(calls[0].context.conversation.id,'agent-maya');assert.equal(calls[0].context.conversation.execution_mode,'read_only');assert.equal(calls[0].context.conversation.scopes.includes('projects'),false);
  await runner.execute('justin','group-launch',run.id);assert.equal(calls.length,1,'builder waits for approval');
  let [saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'needs_approval');
  await runs.act('justin','group-launch',run.id,'approve_step',saved.steps[1].id);currentMembers[1].scopes.push('life');await runner.execute('justin','group-launch',run.id);
  assert.match(calls[1].prompt,/Research finding: local gardening/);assert.match(calls[1].prompt,/Your assignment: build a page/);assert.equal(calls[1].context.conversation.id,'agent-atlas');
  assert.equal(calls[1].context.conversation.scopes.includes('life'),false,'approval cannot silently expand a worker’s access');
  await runner.execute('justin','group-launch',run.id);assert.equal(calls[2].context.conversation.execution_mode,'read_only');assert.match(calls[2].prompt,/Draft PR prepared/);
  [saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'completed');assert.equal(saved.steps.every(step=>step.state==='returned'),true);assert.ok(saved.events.some(event=>event.message.includes('passed it')));
});
test('worker leases prevent duplicate execution and read-only interruptions recover safely',async()=>{
  const {runs,tick}=fixture(),run=await create(runs);await runs.act('justin','group-launch',run.id,'start');
  const first=await runs.claim('justin','group-launch',run.id);assert.equal(await runs.claim('justin','group-launch',run.id),null);
  tick();assert.equal(await runs.claim('justin','group-launch',run.id),null);let [saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'queued');assert.equal(saved.steps[0].state,'retrying');
  const next=await runs.claim('justin','group-launch',run.id);
  await runs.settle('justin','group-launch',run.id,first.step.id,first.step.token,{state:'returned',result:'Stale output'});
  [saved]=await runs.list('justin','group-launch');assert.equal(saved.steps[0].state,'working');assert.equal(saved.steps[0].result,null);
  await runs.settle('justin','group-launch',run.id,next.step.id,next.step.token,{state:'returned',result:'Fresh output'});
  [saved]=await runs.list('justin','group-launch');assert.equal(saved.steps[0].result,'Fresh output');
});
test('expired write-capable workers stop for review instead of repeating side effects',async()=>{
  const {runs,tick}=fixture(),run=await runs.create('justin','group-launch',[members[1]],'@Atlas build it','request-write-lease',{includeNex:false,autoStart:true});
  await runs.claim('justin','group-launch',run.id);let [saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'needs_approval');
  await runs.act('justin','group-launch',run.id,'approve_step',saved.steps[0].id);await runs.claim('justin','group-launch',run.id);tick();assert.equal(await runs.claim('justin','group-launch',run.id),null);
  [saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'blocked');assert.equal(saved.steps[0].state,'interrupted');
});
test('cancellation stops after the current assignment and preserves its result',async()=>{
  const {runs}=fixture(),run=await create(runs);await runs.act('justin','group-launch',run.id,'start');const claim=await runs.claim('justin','group-launch',run.id);
  assert.equal((await runs.act('justin','group-launch',run.id,'cancel')).state,'stopping');
  await runs.settle('justin','group-launch',run.id,claim.step.id,claim.step.token,{state:'returned',result:'Saved partial research'});
  assert.equal((await runs.list('justin','group-launch'))[0].state,'cancelled');assert.equal(await runs.claim('justin','group-launch',run.id),null);
});
test('an exact completed merge approval advances the team without rerunning the specialist',async()=>{
  const {runs}=fixture(),run=await create(runs);await runs.act('justin','group-launch',run.id,'start');const claim=await runs.claim('justin','group-launch',run.id);
  await runs.settle('justin','group-launch',run.id,claim.step.id,claim.step.token,{state:'blocked',result:'PR is ready.',error:'Approval required.',pending_approval:{id:'merge-one',kind:'merge_pull_request',label:'Merge PR #42'}});
  let saved=await runs.act('justin','group-launch',run.id,'resolve_approval',claim.step.id,'merge-one');
  assert.equal(saved.state,'queued');assert.equal(saved.steps[0].state,'returned');assert.equal(saved.steps[0].pending_approval,null);assert.equal(saved.steps[0].approval_receipt.id,'merge-one');
  await assert.rejects(runs.act('justin','group-launch',run.id,'resolve_approval',claim.step.id,'another-merge'),/no longer waiting/);
});
test('provider failures block handoffs; removed members never run; scopes cannot expand after approval',async()=>{
  const {runs,advance,now}=fixture();let people=[...members],calls=0;const runner=createTeamRunner({runs,now,messages:{overview:async()=>({groups:[{id:'group-launch',member_ids:people.map(m=>m.id)}],specialists:people})},mode:async()=>({mode:'engaged'}),history:async()=>null,ask:async()=>{calls++;return {reply:'Providers unavailable',provider:'none'};}});
  const run=await create(runs);await runs.act('justin','group-launch',run.id,'start');await runner.execute('justin','group-launch',run.id);await runner.execute('justin','group-launch',run.id);assert.equal(calls,1);
  let [saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'queued');assert.equal(saved.steps[0].state,'retrying');assert.equal(saved.steps[1].state,'queued');
  advance(30_001);people=[members[1]];await runner.execute('justin','group-launch',run.id);assert.equal(calls,1);[saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'blocked');assert.match(saved.steps[0].error,/removed/);
  const policy=buildConversationAccessPolicy({kind:'group',members,scopes:['conversation','projects','life'],execution_mode:'read_only'});assert.ok(policy.allowedToolNames.has('read_repo_file'));assert.ok(!policy.allowedToolNames.has('patch_repo_file'));assert.ok(!policy.allowedToolNames.has('manage_life'));
});
test('write-capable assignments never auto-retry an uncertain failure',async()=>{
  const {runs,now}=fixture(),people=[members[1]],runner=createTeamRunner({runs,now,messages:{overview:async()=>({groups:[{id:'group-launch',member_ids:['agent-atlas']}],specialists:people})},mode:async()=>({mode:'engaged'}),history:async()=>null,ask:async()=>({reply:'Provider stopped after partial work.',provider:'none'})});
  const run=await runs.create('justin','group-launch',people,'@Atlas build it','request-write-failure',{includeNex:false,autoStart:true});
  await runner.execute('justin','group-launch',run.id);let [saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'needs_approval');
  await runs.act('justin','group-launch',run.id,'approve_step',saved.steps[0].id);await runner.execute('justin','group-launch',run.id);[saved]=await runs.list('justin','group-launch');assert.equal(saved.state,'blocked');assert.equal(saved.steps[0].state,'blocked');
});
test('team API strips worker lease tokens, retains caller scope, and schedules approved work',async()=>{
  const {runs}=fixture(),scheduled=[];const runner={group:async()=>({id:'group-launch',members}),execute:async()=>{}};
  const handle=createTeamMessagesHandler({runs,runner,missions:{track:async()=>{}},schedule:task=>scheduled.push(task)});
  const created=res();await handle({method:'POST',body:{action:'team_create',group_id:'group-launch',message:'@Maya research',request_id:'request-one',owner:'other'}},created,{id:'justin'});
  assert.equal(created.code,200);assert.equal((await runs.list('other','group-launch')).length,0);
  assert.equal(created.body.run.state,'queued');assert.equal(created.body.run.autonomous,true);assert.equal(scheduled.length,1);
  await runs.claim('justin','group-launch',created.body.run.id);const listed=res();await handle({method:'GET',query:{group_id:'group-launch'}},listed,{id:'justin'});assert.equal(listed.body.runs[0].steps[0].token,undefined);assert.equal(listed.body.runs[0].steps[0].lease_until,undefined);
});


test('Nex is optional, @nex selects only Nex, and @team keeps the saved group roster',async()=>{
  const {runs}=fixture();
  const run=await runs.create('justin','group-launch',members,'@team research and build','request-no-nex',{includeNex:false});
  assert.deepEqual(run.steps.map(step=>step.name),['Maya','Atlas']);
  await runs.act('justin','group-launch',run.id,'cancel');
  const nex=await runs.create('justin','group-launch',members,'@nex review this','request-nex',{includeNex:false});
  assert.deepEqual(nex.steps.map(step=>step.name),['Nex']);
  await runs.act('justin','group-launch',nex.id,'cancel');
  const limited=await runs.create('justin','group-launch',members,'@team research','request-limited',{includeNex:false,teamMemberIds:['agent-maya']});
  assert.deepEqual(limited.steps.map(step=>step.name),['Maya']);
});
test('main and specialist chats call any saved agent; group guests do not join permanently',async()=>{
  const {runs}=fixture(),calls=[];
  const state={specialists:members,groups:[{id:'group-launch',kind:'group',include_nex:false,member_ids:['agent-maya']}]};
  const runner=createTeamRunner({runs,messages:{overview:async()=>state},mode:async()=>({mode:'engaged'}),history:async(owner,id)=>({messages:[{role:'user',content:'Use these meal choices.'}]}),ask:async(prompt,h,t,c,stage,tc)=>{calls.push({prompt,h,c,tc});return {reply:'Useful result',provider:'gateway'};}});
  const handler=createTeamMessagesHandler({runs,runner,missions:{track:async()=>{}},schedule:()=>{}});
  for(const thread of ['nex-main','agent-maya','group-launch']){
    const created=res();await handler({method:'POST',body:{action:'team_create',thread_id:thread,message:'@atlas make a meal planner',request_id:'request-'+thread}},created,{id:'justin'});
    assert.deepEqual(created.body.run.steps.map(step=>step.name),['Atlas']);
    await runner.execute('justin',thread,created.body.run.id);
    const [saved]=await runs.list('justin',thread);assert.equal(saved.state,'needs_approval');
    await runs.act('justin',thread,saved.id,'approve_step',saved.steps[0].id);await runner.execute('justin',thread,saved.id);
    assert.equal((await runs.list('justin',thread))[0].state,'completed');
  }
  assert.deepEqual(state.groups[0].member_ids,['agent-maya']);
  assert.ok(calls.every(call=>call.tc.allowAgentDelegation===false));
  assert.ok(calls.every(call=>call.h[0].content==='Use these meal choices.'));
  await assert.rejects(runner.group('justin','agent-removed'),/no longer/);
});
test('agent initiated requests preserve the caller, select one recipient, and cannot recurse',async()=>{
  const {runs}=fixture(),state={specialists:members,groups:[]};
  const delegate=createAgentDelegation({messages:{overview:async()=>state},runs,missions:{track:async()=>{}},id:()=> 'delegation-one'});
  const context={userId:'justin',threadId:'agent-maya',agentName:'Maya'};
  const list=await delegate('list_specialists',{},context);assert.equal(list.agents[1].handle,'atlas');
  const response=await delegate('delegate_agent',{agent_id:'agent-atlas',task:'Make a food page; text includes @team and @Maya.'},context);
  assert.equal(response.state,'queued');
  const [saved]=await runs.list('justin','agent-maya');assert.deepEqual(saved.steps.map(step=>step.name),['Atlas','Maya']);
  assert.equal(saved.requester,'Maya');assert.deepEqual(saved.steps[1].scopes,['conversation']);
  assert.equal(saved.steps[1].requires_approval,false);assert.equal(saved.steps[0].state,'queued');
  assert.match(saved.steps[0].instruction,/＠team/);
  await assert.rejects(delegate('delegate_agent',{agent_id:'agent-atlas',task:'go'},{...context,allowAgentDelegation:false}),/unavailable/);
  await assert.rejects(delegate('delegate_agent',{agent_id:'agent-unknown',task:'go'},context),/available/);
  await assert.rejects(delegate('delegate_agent',{agent_id:'agent-maya',task:'go'},context),/yourself/);
  assert.equal((await runs.list('someoneelse','agent-maya')).length,0);
});
test('chat visual previews block network and do not accept unfenced or oversized output',()=>{
  const doc=chatVisualDocument('Preview:\n```html\n<h1>Food choices</h1>\n```');
  assert.match(doc,/Content-Security-Policy/);assert.match(doc,/connect-src 'none'/);assert.match(doc,/Food choices/);
  assert.equal(chatVisualDocument('<h1>unfenced</h1>'),null);
  assert.equal(chatVisualDocument('```html\n'+'x'.repeat(50001)+'\n```'),null);
});
