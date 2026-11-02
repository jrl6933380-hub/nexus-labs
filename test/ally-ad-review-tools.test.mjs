import test from 'node:test';
import assert from 'node:assert/strict';
import {createAllyAdReview} from '../lib/allyAdReview.js';
import {createWorkspaceService,WORKSPACE_WRITES} from '../lib/workspaceConnector.js';
import {WORKSPACE_TOOLS} from '../lib/workspaceBoard.js';
const job_id='11111111-1111-4111-8111-111111111111';
test('typed review commands use the existing bounded transport and quote the brief as data',async()=>{
 const calls=[],api=createAllyAdReview({uuid:()=>job_id,ally:{enqueue:async(...args)=>{calls.push(args);return {command_id:'receipt',status:'queued'};}}});
 const brief="Plan an ad. ' ; Write-Output HARMFUL; #";
 const r=await api.start('justin',{brief});assert.equal(r.job_id,job_id);assert.equal(r.requires_result_read,true);
 const c=calls[0][1];assert.equal(c.action,'terminal');assert.equal(c.timeout_seconds,10);
 assert.ok(c.script.includes("ad. '' ; Write-Output HARMFUL; #"));assert.ok(c.script.includes('installed.json'));assert.ok(!c.script.includes('Invoke-Expression'));
 await api.status('justin',{job_id});await api.stop('justin',{job_id});assert.equal(calls.length,3);
 assert.ok(calls.every(x=>x[0]==='justin'&&x[1].script.length<=4000));
 await assert.rejects(api.start('justin',{brief:'x'.repeat(1001)}),/1–1000/);
 await assert.rejects(api.status('justin',{job_id:'../../other'}),/job_id/);
});
test('review tools are owner-only mutations with request ids; customer cannot queue inspections',async()=>{
 const calls=[],service=createWorkspaceService({ally:{enqueue:async(...x)=>{calls.push(x);return {command_id:'queued'};}}});
 const owner={id:'justin',owner:true,workbenchUserId:'owner',scheduleUserId:'owner'};
 for(const [action,input] of [['ally_ad_start',{brief:'Nexus concept'}],['ally_ad_status',{job_id}],['ally_ad_stop',{job_id}]]){
  assert.ok(WORKSPACE_WRITES.has(action));await assert.rejects(service(action,input,{...owner,owner:false}),/owner only/);await service(action,input,owner);
 }
 assert.equal(calls.length,3);
 const tools=WORKSPACE_TOOLS.filter(x=>['ally_ad_start','ally_ad_status','ally_ad_stop'].includes(x[1]));assert.equal(tools.length,3);
 assert.ok(tools.every(x=>x[4]===true&&x[3].request_id));
});
