import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryHandler} from '../api/room-history.js';
import {executeWorkbenchTool,projectDestination,restrictToWorkbench,freshBuildTarget} from '../lib/workbenchTools.js';
import {buildConversationAccessPolicy} from '../lib/nexBrain.js';
import {planCognitiveRun} from '../lib/nexCognitiveController.js';
import {createEvidenceTracker} from '../lib/nexEvidenceGate.js';
import {createReasoningState,registerReasoningToolCall,recordReasoningToolResult,finalizeReasoningState} from '../lib/nexReasoningLoop.js';
import {saveTeamProjects} from '../lib/teamProjectSave.js';

test('agent builds save, reopen and edit in the real Projects handler with ownership and baseline checks',async()=>{
  let sequence=0;const saved=new Map();
  const latest=async(owner,id)=>saved.get(owner+':'+id) || null;
  const deps={readLatest:latest,projectLock:async(owner,task)=>task(),historyFactory:options=>createHistoryHandler({...options,
    readLatestProject:latest,readProjects:async owner=>[...saved].filter(([key])=>key.startsWith(owner+':')).map(([,value])=>value),
    resolvePlan:async()=> 'pro',writeBuild:async(owner,value)=>{const build={...value,id:'b'+(++sequence)};saved.set(owner+':'+value.projectId,build);return build;},
  })};
  const context={userId:'alice',threadId:'group-workout'};
  const html='<!doctype html><html><title>Workout Timer</title><button onclick="start()">Start</button><script>function start(){}</script></html>';
  const result=await executeWorkbenchTool('save_workbench_project',{project_id:'workout',html},context,deps);
  assert.equal(result.location,'Projects');assert.equal(result.published,false);
  assert.equal(saved.get('alice:workout').html,html);
  assert.equal((await executeWorkbenchTool('save_workbench_project',{project_id:'workout',html},context,deps)).build_id,result.build_id);
  const read=await executeWorkbenchTool('read_workbench_project',{project_id:'workout'},context,deps);
  await assert.rejects(executeWorkbenchTool('read_workbench_project',{project_id:'workout'},{userId:'bob'},deps),/not found/);
  const edited=await executeWorkbenchTool('save_workbench_project',{project_id:'workout',baseline:read.baseline,html:html.replace('Start','Begin')},context,deps);
  assert.notEqual(edited.build_id,read.baseline);
  await assert.rejects(executeWorkbenchTool('save_workbench_project',{project_id:'workout',baseline:read.baseline,html},context,deps),/changed/);
  await assert.rejects(executeWorkbenchTool('save_workbench_project',{project_id:'workout',html},{},deps),/Sign in/);
});

test('project allowance is enforced through the existing handler',async()=>{
  const deps={projectLock:async(owner,task)=>task(),historyFactory:options=>createHistoryHandler({...options,readLatestProject:async()=>null,readProjects:async()=>[{id:'already-full'}],resolvePlan:async()=> 'free',writeBuild:async()=>{throw Error('must not write');}})};
  await assert.rejects(executeWorkbenchTool('save_workbench_project',{project_id:'another',html:'<h1>App</h1>'},{userId:'alice'},deps),/limit/);
});

test('project mutation stays behind approved specialist scope and build completion requires a save',()=>{
  const readonly=buildConversationAccessPolicy({kind:'specialist',role:'review',scopes:['projects'],execution_mode:'read_only'});
  assert.equal(readonly.allowedToolNames.has('save_workbench_project'),false);
  assert.equal(readonly.allowedToolNames.has('read_workbench_project'),true);
  assert.equal(projectDestination('Build a workout timer app'),'workbench');
  assert.equal(projectDestination('Patch the GitHub repository'),'repository');
  assert.equal(projectDestination('List my repos'),'repository');
  const plan=planCognitiveRun({message:'Build a workout timer app',toolContext:{buildDestination:'workbench',workbenchBuild:true,cognitiveLane:'chat'}});
  const evidence=createEvidenceTracker(plan);
  assert.equal(evidence.receipt().status,'incomplete');
  evidence.record({name:'save_workbench_project',input:{}},{is_error:true,content:'limit reached'});
  assert.equal(evidence.receipt().status,'incomplete');
  evidence.record({name:'save_workbench_project',input:{}},{content:'{"saved":true}'});
  assert.equal(evidence.receipt().status,'verified');
});

test('Workbench routing removes repository access without expanding a scoped assignment',()=>{
  const tools=['list_repos','create_branch','save_workbench_project','read_workbench_project','run_sandbox'].map(name=>({name}));
  const repository=['list_repos','create_branch','run_sandbox'];
  const owner=restrictToWorkbench({allowedToolNames:null},tools,repository);
  assert.equal(owner.allowedToolNames.has('create_branch'),false);
  assert.equal(owner.allowedToolNames.has('list_repos'),false);
  assert.equal(owner.allowedToolNames.has('save_workbench_project'),true);
  const scoped=restrictToWorkbench({allowedToolNames:new Set(['read_workbench_project'])},tools,repository);
  assert.deepEqual([...scoped.allowedToolNames],['read_workbench_project']);
});

test('a native saved team project is not duplicated by legacy HTML promotion',async()=>{
  let calls=0;
  await saveTeamProjects({},'group-workout',[{state:'completed',steps:[{state:'returned',role:'build',saved_project:{project_id:'workout'},result:'```html\n<h1>Workout</h1>\n```'}]}],{handler:async()=>{calls++;}});
  assert.equal(calls,0);
});


test('two rejected saves lead to a corrected input and a real saved Projects preview',async()=>{
  const saved=[];
  const deps={projectLock:async(owner,task)=>task(),historyFactory:options=>createHistoryHandler({...options,readLatestProject:async()=>null,readProjects:async()=>[],resolvePlan:async()=> 'pro',writeBuild:async(owner,build)=>{saved.push({...build,owner});return {...build,id:'verified-build'};}})};
  const state=createReasoningState({message:'Build a workout timer',budgets:{continueUntilPreview:true}}),context={userId:'alice',threadId:'group-workout'};
  const html='<!doctype html><html><title>Workout</title><body><button>Start</button></body></html>';
  const call={name:'save_workbench_project',input:{project_id:'Body weight 1',html}};
  for(let i=0;i<2;i++){
    assert.equal(registerReasoningToolCall(state,call).allowed,true);
    let message;try{await executeWorkbenchTool(call.name,call.input,context,deps);}catch(error){message=error.message;}
    assert.match(message,/Fix project_id/);recordReasoningToolResult(state,call,{is_error:true,content:message});
  }
  assert.equal(state.status,'running');assert.equal(saved.length,0);
  const fixed={...call,input:{...call.input,project_id:'bodyweight-1'}};
  assert.equal(registerReasoningToolCall(state,fixed).allowed,true);
  const result=await executeWorkbenchTool(fixed.name,fixed.input,context,deps);
  recordReasoningToolResult(state,fixed,{content:JSON.stringify(result)});
  finalizeReasoningState(state,{status:'verified',missing:[]});
  assert.equal(state.status,'completed');assert.equal(result.saved,true);assert.equal(result.build_id,'verified-build');
  assert.equal(saved[0].html,html);assert.equal(saved[0].owner,'alice');
  await assert.rejects(executeWorkbenchTool('save_workbench_project',{project_id:'ok',html:{body:'bad'}},context,deps),/Fix html/);
});


test('owner background saves use the same Workbench account as the visible shelf',async()=>{
 const touched=[],projects=Array.from({length:12},(_,i)=>({projectId:'old-'+i}));
 const deps={projectLock:async(owner,task)=>task(),historyFactory:options=>createHistoryHandler({...options,
  readLatestProject:async(owner)=>{touched.push(owner);return null;},readProjects:async(owner)=>{touched.push(owner);return projects;},resolvePlan:async()=> 'free',
  writeBuild:async(owner,input)=>{touched.push(owner);return {...input,id:'new-build'};},
 })};
 const result=await executeWorkbenchTool('save_workbench_project',{project_id:'fresh',html:'<!doctype html><html>Workout</html>'},{userId:'justin',workbenchUserId:'Mrlopez'},deps);
 assert.equal(result.saved,true);assert.ok(touched.length>=3);assert.ok(touched.every(owner=>owner==='Mrlopez'));
 await assert.rejects(executeWorkbenchTool('save_workbench_project',{project_id:'other',html:'<html>Other</html>'},{userId:'customer'},deps),error=>error.status===402);
});


test('new build destinations are reserved per run and cannot overwrite another page',async()=>{
 assert.equal(freshBuildTarget('Build a fresh project','nex-turn-task-12345678'),'build-task-12345678');assert.equal(freshBuildTarget('Edit this existing project','nex-turn-task-12345678'),null);
 assert.notEqual(freshBuildTarget('Build an app','nex-turn-task-12345678'),freshBuildTarget('Build an app','nex-turn-task-87654321'));
 await assert.rejects(executeWorkbenchTool('save_workbench_project',{project_id:'audit-page',html:'<html>Workout</html>'},{userId:'alice',freshProjectId:'fresh-workout'}),/reserved fresh target/);
});
