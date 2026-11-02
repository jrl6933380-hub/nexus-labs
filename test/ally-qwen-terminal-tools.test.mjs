import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceService,WORKSPACE_WRITES} from '../lib/workspaceConnector.js';
import {WORKSPACE_TOOLS} from '../lib/workspaceBoard.js';
const id='11111111-1111-4111-8111-111111111111';
test('Qwen local task controls are owner-only and use paired terminal transport',async()=>{
 const calls=[];const service=createWorkspaceService({ally:{enqueue:async(...args)=>{calls.push(args);return {command_id:id,status:'queued'};}}});
 const owner={id:'justin',owner:true,workbenchUserId:'owner',scheduleUserId:'owner'};
 const cases=[['ally_qwen_start',{task:'Create hello.mjs'}],['ally_qwen_status',{job_id:id}],['ally_qwen_stop',{job_id:id}]];
 for(const [action,input] of cases){
  assert.ok(WORKSPACE_WRITES.has(action));
  await assert.rejects(service(action,input,{...owner,owner:false}),/owner only/);
  await service(action,input,owner);
 }
 assert.equal(calls.length,3);
 assert.ok(calls.every(([user,command])=>user==='justin'&&command.action==='terminal'&&command.timeout_seconds<=10));
 const tools=WORKSPACE_TOOLS.filter(x=>cases.some(([action])=>x[1]===action));
 assert.equal(tools.length,3);assert.ok(tools.every(x=>x[4]===true&&x[3].request_id));
});
