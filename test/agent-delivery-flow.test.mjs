import test from 'node:test';
import assert from 'node:assert/strict';
import {readTeamHandoff} from '../lib/teamHandoffTools.js';
import {readWorkbenchInspection,inspectionScript} from '../lib/workbenchInspection.js';
import {buildConversationAccessPolicy} from '../lib/nexBrain.js';

test('complete handoff retrieval is bound to the current owner, group and mission',async()=>{
 const calls=[],runs={list:async(owner,group)=>{calls.push([owner,group]);return [{id:'mission-one',steps:[{id:'step-one',state:'returned',role:'research',name:'Atlas',result:'full '.repeat(5000)}]}];}};
 const context={userId:'alice',teamGroupId:'team-a',teamRunId:'mission-one'};
 const result=await readTeamHandoff({step_id:'step-one',owner:'bob',run_id:'other'},context,{runs});assert.equal(result.result.length,25000);assert.deepEqual(calls,[['alice','team-a']]);
 await assert.rejects(readTeamHandoff({step_id:'step-one'},{...context,teamRunId:'other'},{runs}),/not part/);
 await assert.rejects(readTeamHandoff({step_id:'step-one'},{userId:'alice'},{runs}),/only inside/);
});

test('browser inspection reads the owned saved version, reports actual results and always closes the sandbox',async()=>{
 let killed=0;const writes=[],calls=[];
 const result=await readWorkbenchInspection({project_id:'workout',checks:[{kind:'expect_text',selector:'#clock',value:'0:30'}]},{userId:'justin',workbenchUserId:'Mrlopez'},{readLatest:async(owner,id)=>{calls.push([owner,id]);return {id:'b7',html:'<html>Workout</html>'};},createSandbox:async()=>({files:{write:async(...args)=>writes.push(args)},commands:{run:async()=>({exitCode:0,stdout:JSON.stringify({status:'needs_repair',errors:['Timer error'],viewports:[],assertions:[]})})},kill:async()=>{killed++;}})});
 assert.deepEqual(calls,[['Mrlopez','workout']]);assert.equal(result.baseline,'b7');assert.equal(result.status,'needs_repair');assert.equal(killed,1);assert.equal(writes[0][0],'index.html');
 const source=inspectionScript([{kind:'reload'}]);assert.match(source,/serviceWorkers:'block'/);assert.match(source,/route.abort/);assert.match(source,/320,768,1440/);
 await assert.rejects(readWorkbenchInspection({project_id:'workout'},{userId:'alice'},{readLatest:async()=>({id:'b1',html:'<html></html>'}),createSandbox:async()=>({files:{write:async()=>{throw new Error('failed upload');}},kill:async()=>{killed++;}})}),/failed upload/);assert.equal(killed,2);
});

test('Vera gets inspection and handoff reads but cannot save, deploy or execute arbitrary commands',()=>{
 const policy=buildConversationAccessPolicy({kind:'specialist',role:'review',scopes:['conversation','projects'],execution_mode:'read_only'});
 assert.equal(policy.allowedToolNames.has('read_workbench_inspection'),true);assert.equal(policy.allowedToolNames.has('read_team_handoff'),true);
 for(const name of ['save_workbench_project','run_sandbox','test_code','create_pull_request'])assert.equal(policy.allowedToolNames.has(name),false);
});
