import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeTool,runAgent,runJob,localModel} from '../scripts/ally/qwen-terminal-agent.mjs';
import {createAllyQwenTerminal} from '../lib/allyQwenTerminal.js';
const act=(tool,args={})=>({tool,args});
const reply=a=>JSON.stringify(a);
test('Qwen writes only new files inside workspace and parses its code safely',async()=>{
 const w=await mkdtemp(join(tmpdir(),'qwen-safe-'));
 try{
  const r=await executeTool(act('write_file',{path:'code/hello.mjs',content:'export const answer=42;\n'}),{workspace:w});
  assert.equal(r.created,'code/hello.mjs');
  assert.match((await executeTool(act('read_file',{path:'code/hello.mjs'}),{workspace:w})).content,/answer=42/);
  assert.deepEqual((await executeTool(act('run_command',{command:'node_check',path:'code/hello.mjs'}),{workspace:w})).exit_code,0);
  await assert.rejects(executeTool(act('write_file',{path:'code/hello.mjs',content:'overwrite'}),{workspace:w}),e=>e.code==='EEXIST');
  const edited=await executeTool(act('edit_file',{path:'code/hello.mjs',old_text:'answer=42',new_text:'answer=43'}),{workspace:w});
  assert.equal(edited.edited,'code/hello.mjs');
  assert.match(await readFile(join(w,'code/hello.mjs'),'utf8'),/answer=43/);
  await assert.rejects(executeTool(act('edit_file',{path:'code/hello.mjs',old_text:'missing',new_text:'bad'}),{workspace:w}),/match exactly once/);
  for(const p of ['../outside','C:/secrets.txt','//server/secret','.git/config','a/../../bad'])await assert.rejects(executeTool(act('read_file',{path:p}),{workspace:w}));
  const outside=await mkdtemp(join(tmpdir(),'qwen-outside-'));
  try{await symlink(outside,join(w,'escape'),'dir');await assert.rejects(executeTool(act('write_file',{path:'escape/x',content:'bad'}),{workspace:w}),/Links/);}finally{await rm(outside,{recursive:true,force:true});}
 }finally{await rm(w,{recursive:true,force:true});}
});
test('Unrestricted shell and ALL git commands are blocked without invocation',async()=>{
 const w=await mkdtemp(join(tmpdir(),'qwen-safe-'));let called=0;
 try{
  for(const command of ['powershell -Command Remove-Item C:\\','cmd /c echo hello','git_status','git_log','git_diff_stat','npm install']){
   const res=await executeTool(act('run_command',{command}),{workspace:w,commandRunner:()=>{called++;}});
   assert.equal(res.blocked,true,command);assert.equal(res.approval_required,undefined);
  }
  assert.equal(called,0);
  const actions=[act('run_command',{command:'git_status'}),act('finish',{message:'Git tools are not available'})];
  const r=await runAgent({task:'Try git',workspace:w,generate:async()=>reply(actions.shift())});
  assert.equal(r.status,'done');assert.equal(actions.length,0);
  assert.equal(r.history[0].result.blocked,true);
 }finally{await rm(w,{recursive:true,force:true});}
});
test('Qwen tool loop accepts only structured JSON, never code or instructions from files',async()=>{
 const w=await mkdtemp(join(tmpdir(),'qwen-safe-'));
 try{
  const q=["require('fs').rmSync('anything')",reply(act('list_files',{path:'.'})),reply(act('write_file',{path:'notes.txt',content:'Hello Qwen'})),reply(act('finish',{message:'Created notes.txt'}))];
  const states=[];const r=await runAgent({task:'Write a text note',workspace:w,generate:async()=>q.shift(),onEvent:async x=>states.push(x.status)});
  assert.equal(r.status,'done');assert.equal(r.answer,'Created notes.txt');assert.equal(await readFile(join(w,'notes.txt'),'utf8'),'Hello Qwen');assert.ok(r.history.some(x=>x.error));assert.ok(states.includes('done'));
 }finally{await rm(w,{recursive:true,force:true});}
});
test('the terminal allows only fixed Node syntax checks, never executes website scripts',async()=>{
 const w=await mkdtemp(join(tmpdir(),'qwen-safe-'));let received;
 try{
  await writeFile(join(w,'site.mjs'),'export const answer=42;');
  const r=await executeTool(act('run_command',{command:'node_check',path:'site.mjs'}),{workspace:w,commandRunner:async(...x)=>{received=x;return {stdout:'ok',stderr:''};}});
  assert.equal(r.exit_code,0);assert.equal(received[0],process.execPath);
  assert.deepEqual(received[1],['--check',join(w,'site.mjs')]);assert.equal(received[2].shell,false);
 }finally{await rm(w,{recursive:true,force:true});}
});
test('durable job is not overwritten, can fail closed and leaves private state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-job-'));const job=join(root,'job');const workspace=join(root,'space');
 try{
  const r=await runJob({task:'Make note'},job,{workspace,generate:async()=>reply(act('finish',{message:'Done'}))});assert.equal(r.status,'done');
  const state=JSON.parse(await readFile(join(job,'state.json'),'utf8'));assert.equal(state.status,'done');
  const r2=await runJob({task:'Other'},job,{workspace,generate:async()=>{throw Error('should not run');}});
  assert.equal(r2.status,'failed');assert.equal(JSON.parse(await readFile(join(job,'state.json'),'utf8')).status,'done');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('localhost-only Qwen invocation never passes tools or shell output as a command',async()=>{
 const calls=[];const g=localModel({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'qwen-local'}]})};return {ok:true,json:async()=>({choices:[{message:{content:reply(act('finish',{message:'OK'}))}}]})};}});
 const s=await g([{role:'system',content:'test'}]);assert.match(s,/finish/);
 assert.equal(calls.length,2);assert.ok(calls.every(x=>x.url.startsWith('http://127.0.0.1:9931/')));
 const body=JSON.parse(calls[1].options.body);assert.equal(body.tools,undefined);assert.equal(body.chat_template_kwargs.enable_thinking,false);
});
test('owner bridge quotes task, enforces job-id shape and returns command receipt',async()=>{
 const id='11111111-1111-4111-8111-111111111111';const calls=[];const t=createAllyQwenTerminal({uuid:()=>id,ally:{enqueue:async(...args)=>{calls.push(args);return {command_id:'receipt',status:'queued'};}}});
 const started=await t.start('justin',{task:"Make a file ' ; Write-Output NOPE"});assert.equal(started.job_id,id);assert.equal(started.requires_result_read,true);
 assert.match(calls[0][1].script,/'' ; Write-Output NOPE/);
 await t.status('justin',{job_id:id});await t.stop('justin',{job_id:id});assert.equal(calls.length,3);
 await assert.rejects(t.status('justin',{job_id:'../../other'}),/job_id/);
});


test('guarded task plans checkpoint progress without granting additional privileges',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-plan-'));
 const planState={steps:[]};
 try{
  await assert.rejects(executeTool(act('set_plan',{steps:[]}),{workspace:root,planState}),/Plan needs/);
  const plan=await executeTool(act('set_plan',{steps:['Create a safe note','Check what was written']}),{workspace:root,planState});
  assert.equal(plan.plan.length,2);
  await assert.rejects(executeTool(act('set_plan',{steps:['Overwrite prior plan']}),{workspace:root,planState}),/already exists/);
  await executeTool(act('update_step',{id:1,status:'in_progress'}),{workspace:root,planState});
  assert.equal((await executeTool(act('get_plan',{}),{workspace:root,planState})).plan[0].status,'in_progress');
  await executeTool(act('update_step',{id:1,status:'done'}),{workspace:root,planState});
  await assert.rejects(executeTool(act('update_step',{id:1,status:'blocked'}),{workspace:root,planState}),/cannot be reopened/);
  await assert.rejects(executeTool(act('update_step',{id:99,status:'done'}),{workspace:root,planState}),/existing plan step/);
  assert.equal(planState.steps[0].status,'done');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Qwen work runner persists a step-by-step plan and truthful completed steps',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-plan-runner-'));const states=[];
 try{
  const steps=[
   act('set_plan',{steps:['Write the note','Verify the note']}),
   act('update_step',{id:1,status:'in_progress'}),
   act('write_file',{path:'ad-notes.txt',content:'Draft ad idea'}),
   act('update_step',{id:1,status:'done'}),
   act('update_step',{id:2,status:'in_progress'}),
   act('read_file',{path:'ad-notes.txt'}),
   act('update_step',{id:2,status:'done'}),
   act('finish',{message:'Saved and verified ad-notes.txt'})
  ];
  const result=await runAgent({task:'Write and verify an ad note',workspace:root,generate:async()=>reply(steps.shift()),onEvent:async e=>states.push(JSON.parse(JSON.stringify(e)))});
  assert.equal(result.status,'done');assert.equal(result.plan.length,2);
  assert.deepEqual(result.plan.map(s=>s.status),['done','done']);
  assert.ok(states.some(s=>s.plan?.some(t=>t.status==='in_progress')),'progress checkpoints emitted before completion');
  assert.ok(states.some(s=>s.plan?.every(t=>t.status==='done')),'completion checkpoint emitted');
  assert.equal(await readFile(join(root,'ad-notes.txt'),'utf8'),'Draft ad idea');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unfinished Qwen task plan ends as needs_help, never falsely done',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-incomplete-'));
 try{
  const actions=[act('set_plan',{steps:['Write file','Verify file']}),act('write_file',{path:'draft.txt',content:'in progress'}),act('finish',{message:'Everything finished'})];
  const result=await runAgent({workspace:root,task:'Make and verify file',generate:async()=>reply(actions.shift())});
  assert.equal(result.status,'needs_help');
  assert.deepEqual(result.plan.map(x=>x.status),['pending','pending']);
  assert.match(result.reason,/unfinished plan/);
 }finally{await rm(root,{recursive:true,force:true});}
});
