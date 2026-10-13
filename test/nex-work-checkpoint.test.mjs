import test from 'node:test';
import assert from 'node:assert/strict';
import {captureWorkCheckpoint,saveWorkCheckpoint,loadWorkCheckpoint,formatWorkCheckpoint} from '../lib/nexWorkCheckpoint.js';
import {createNexRunState,advanceNexRunState,persistNexRunState,loadNexRunState,publicRunState} from '../lib/nexRunState.js';

function storage(){const values=new Map();return {values,redis:async([verb,key,value])=>{if(verb==='SET'){values.set(key,value);return 'OK';}return values.get(key) || null;}};}

test('timeout continuation reloads complete test code, real results and exact saved project from private storage',async()=>{
 const db=storage(),id='nex-turn-team-timeout-1234',state=createNexRunState({scopeId:'justin',resumeRunId:id});let pointer;
 const source='const timer = '+JSON.stringify('workout '.repeat(1000))+'; console.log(timer.length);';
 Object.assign(state,advanceNexRunState(state,{name:'run_sandbox',input:{commands:['node timer.js'],files:{'timer.js':source}}},{content:'PASS: 1:01:11 is the expected output.'}));
 Object.assign(state,advanceNexRunState(state,{name:'save_workbench_project',input:{project_id:'workout',html:'<!doctype html><html>'+source+'</html>'}},{content:JSON.stringify({saved:true,project_id:'workout',build_id:'b7',label:'Workout'})}));
 state.state='waiting';state.blocker='provider_unavailable';
 await persistNexRunState(state,{checkpointExecution:async value=>{pointer=value;},workCheckpoint:db});
 assert.equal(JSON.stringify(pointer).includes(source),false);
 const resumed=await loadNexRunState({scopeId:'justin',resumeRunId:id},{getExecutionResume:async()=>pointer,workCheckpoint:db});
 assert.equal(resumed.resumed,true);assert.equal(resumed.workRecords[0].input.files['timer.js'],source);
 assert.equal(resumed.savedProject.project_id,'workout');assert.equal(resumed.savedProject.build_id,'b7');
 assert.match(formatWorkCheckpoint(resumed),/PASS: 1:01:11/);assert.match(formatWorkCheckpoint(resumed),/Do not repeat successful tests/);
 assert.equal(JSON.stringify(publicRunState(resumed)).includes(source),false);
});

test('another owner or new assignment cannot recover the previous assignment work',async()=>{
 const db=storage(),state=createNexRunState({scopeId:'alice',resumeRunId:'nex-turn-one-12345678'});
 captureWorkCheckpoint(state,{name:'test_code',input:{code:'private draft'}},{content:'passed'});await saveWorkCheckpoint(state,db);
 for(const params of [{scopeId:'bob',resumeRunId:state.runId},{scopeId:'alice',resumeRunId:'nex-turn-two-12345678'}]){
  const other=createNexRunState(params);other.resumed=true;await loadWorkCheckpoint(other,db);assert.equal(other.workRecords,undefined);assert.equal(formatWorkCheckpoint(other),'');
 }
});

test('checkpoints redact credentials, preserve failure status and bound complete records without cutting source',()=>{
 const state=createNexRunState({scopeId:'alice'});
 captureWorkCheckpoint(state,{name:'read_secret',input:{password:'do-not-store'}},{content:'secret output'});assert.equal(state.workRecords,undefined);
 captureWorkCheckpoint(state,{name:'test_code',input:{code:'const key="ghp_123456789012345678901234567890123456";'}},{content:'Failed assertion',is_error:true});
 assert.doesNotMatch(JSON.stringify(state.workRecords),/ghp_123456789/);assert.equal(state.workRecords[0].failed,true);
 for(let i=0;i<10;i++)captureWorkCheckpoint(state,{name:'test_code',input:{code:'x'.repeat(40000)+i}},{content:'passed'});
 assert.ok(state.workRecords.length<=4);assert.ok(JSON.stringify(state.workRecords).length<=160000);assert.ok(state.workRecords.every(record=>record.input.code.length===40001));
});


test('an unsaved complete page stays pinned after recent tool records roll over and progress survives resume',async()=>{
 const db=storage(),state=createNexRunState({scopeId:'alice',resumeRunId:'nex-turn-pinned-draft-12345678'}),html='<html>'+ 'draft '.repeat(5000)+'</html>';
 captureWorkCheckpoint(state,{name:'save_workbench_project',input:{project_id:'workout',html}},{content:'Temporary save failure',is_error:true});
 for(let i=0;i<8;i++)captureWorkCheckpoint(state,{name:'test_code',input:{code:'check '+i}},{content:'passed'});
 state.outcomeSignatures=[['same-call','same-result']];state.unchangedOutcomes=3;await saveWorkCheckpoint(state,db);
 const resumed={...state,resumed:true,workDraft:null,workRecords:[]};await loadWorkCheckpoint(resumed,db);
 assert.equal(resumed.workDraft.html,html);assert.ok(resumed.workRecords.length<=4);assert.equal(resumed.unchangedOutcomes,3);assert.deepEqual(resumed.outcomeSignatures,state.outcomeSignatures);
});
