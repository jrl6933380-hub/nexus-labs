import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceService,WORKSPACE_WRITES} from '../lib/workspaceConnector.js';
import {WORKSPACE_TOOLS} from '../lib/workspaceBoard.js';
const owner={id:'justin',owner:true,workbenchUserId:'owner',scheduleUserId:'owner'};
test('terminal and updater are owner-only writes and dispatch exact bounded commands',async()=>{
 const calls=[],service=createWorkspaceService({ally:{enqueue:async(...args)=>{calls.push(args);return {command_id:'queued'};}}});
 for(const [action,input] of [['ally_terminal',{script:'Get-Date'}],['ally_update',{revision:'a'.repeat(40),sha256:'b'.repeat(64)}]]) {
  assert.ok(WORKSPACE_WRITES.has(action));
  await assert.rejects(service(action,input,{...owner,owner:false}),/owner only/);
  await service(action,input,owner);
 }
 assert.deepEqual(calls,[['justin',{action:'terminal',script:'Get-Date',timeout_seconds:20}],['justin',{action:'self_update',revision:'a'.repeat(40),sha256:'b'.repeat(64)}]]);
 const tools=WORKSPACE_TOOLS.filter(t=>['ally_terminal','ally_update'].includes(t[1]));
 assert.equal(tools.length,2);assert.ok(tools.every(t=>t[4]===true));
 const terminal=tools.find(t=>t[1]==='ally_terminal')[3];
 assert.equal(terminal.script.safeParse('x'.repeat(4001)).success,false);
 assert.equal(terminal.timeout_seconds.safeParse(21).success,false);
});
