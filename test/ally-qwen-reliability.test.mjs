import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boundedToolContext,compactJobState,runAgent} from '../scripts/ally/qwen-terminal-agent.mjs';
import {chat,listJobs,createConsoleServer,HOST,PORT} from '../scripts/ally/qwen-console.mjs';

const a=(tool,args={})=>JSON.stringify({tool,args});

test('tool exceptions fail closed and never let Qwen claim a successful job',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'qwen-tool-fail-'));
 try{
  let calls=0;
  const result=await runAgent({task:'Create a note',workspace,generate:async()=>{calls++;return calls===1?a('edit_file',{path:'missing.txt',old_text:'a',new_text:'b'}):a('finish',{message:'Done'});}});
  assert.equal(result.status,'needs_help');assert.match(result.reason,/ENOENT|no such file/i);
  assert.equal(calls,1);
  assert.equal(result.history[0].tool,'edit_file');
  const syntax=await runAgent({task:'Check a JavaScript file',workspace,generate:async()=>a('run_command',{command:'node_check',path:'invalid.mjs'}),execute:async()=>({command:'node_check',exit_code:1,stderr:'SyntaxError: unexpected token'})});
  assert.equal(syntax.status,'needs_help');assert.match(syntax.reason,/Code syntax check failed/);
 }finally{await rm(workspace,{force:true,recursive:true});}
});

test('bounded work context preserves owner request and plan but drops old large tool replies',()=>{
 const initial=[{role:'system',content:'GUARDRAILS'},{role:'user',content:'Owner asks for new site'}];
 const flood=Array.from({length:30},(_,i)=>({role:i%2?'user':'assistant',content:'tool reply '+i+' '+('x'.repeat(8000))}));
 const out=boundedToolContext([...initial,...flood],{plan:[{id:1,title:'Create site',status:'done'},{id:2,title:'Review CSS',status:'in_progress'}],starter:{path:'sites/demo/index.html',template:'barbershop'}});
 assert.equal(out[0],initial[0]);assert.equal(out[1],initial[1]);assert.ok(out.length<=7);
 assert.match(out[2].content,/sites\/demo\/index.html/);
 assert.match(out[2].content,/in_progress/);
 assert.equal(out.at(-1).content.length,2400);
 assert.ok(JSON.stringify(out).length<9000);
});

test('durable job state omits unbounded text but keeps macro preview and failure evidence',()=>{
 const big='X'.repeat(11000);
 const history=Array.from({length:20},(_,i)=>({step:i,tool:i===0?'site_starter':'edit_file',args:{path:'sites/demo/index.html',old_text:big,new_text:big,action:'preview_ad'},result:{status:'succeeded',content:big,created:i===0?'sites/demo/index.html':undefined}}));
 const compact=compactJobState({status:'done',history,plan:[{id:1,title:'Build',status:'done'}],answer:'Saved'});
 const json=JSON.stringify(compact);
 assert.ok(Buffer.byteLength(json)<26000);
 assert.equal(compact.history[0].tool,'site_starter');
 assert.equal(compact.history[0].args.path,'sites/demo/index.html');
 assert.equal(compact.history[1].args.new_text,undefined);
 assert.equal(compact.history[0].result.content,undefined);
 assert.equal(compact.status,'done');
});

test('site starter appears in safe preview list when no model edits follow',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-macro-preview-'));
 try{
  const id='12345678-1234-4321-8123-123456789abc';const folder=join(root,'jobs',id);await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'state.json'),JSON.stringify(compactJobState({status:'done',history:[{step:0,tool:'site_starter',args:{path:'sites/demo/index.html'},result:{status:'succeeded'}}]})));
  await writeFile(join(folder,'request.json'),JSON.stringify({task:'Create a site'}));
  const jobs=await listJobs(root);assert.equal(jobs[0].status,'done');assert.deepEqual(jobs[0].previewPaths,['sites/demo/index.html']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('local chat sends only the six recent bounded history messages without deleting saved chat',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(url.endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'local-qwen'}]})};
  return {ok:true,json:async()=>({choices:[{message:{content:'{"kind":"reply","answer":"Hello"}'}}]})};
 };
 const history=Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',content:String(i)+('x'.repeat(1000))}));
 const result=await chat({message:'Current question',history},{fetchImpl});assert.equal(result.answer,'Hello');
 const body=JSON.parse(calls.at(-1).opts.body);
 const older=body.messages.filter(x=>x.role==='assistant'||(x.role==='user'&&x.content!=='Current question'));
 assert.equal(older.length,6);assert.ok(older.every(x=>x.content.length<=600));
 assert.equal(body.messages.at(-1).content,'Current question');
});

test('model context summarizes previous large HTML tool calls instead of replaying broken JSON',()=>{
 const huge={tool:'write_file',args:{path:'sites/a/index.html',content:'<html>'+('G'.repeat(7000))+'</html>'}};
 const out=boundedToolContext([
  {role:'system',content:'only approved local actions'},
  {role:'user',content:'Build a local page'},
  {role:'assistant',content:JSON.stringify(huge)},
  {role:'user',content:'Tool result: {"created":"sites/a/index.html"}'},
  {role:'assistant',content:JSON.stringify(huge)},
  {role:'user',content:'Tool result: file exists'}
 ]);
 const lastAction=out.filter(m=>m.role==='assistant').at(-1);
 const parsed=JSON.parse(lastAction.content);
 assert.equal(parsed.tool,'write_file');
 assert.equal(parsed.args.path,'sites/a/index.html');
 assert.equal(parsed.args.content,undefined);
 assert.equal(parsed.previous_action_summary,true);
 assert.ok(out.every(m=>m.content.length<3000));
});

test('single-slot Qwen rejects new chat and vision requests while approved work runs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-one-slot-'));
 const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',folder=join(root,'jobs',id);
 const fetchImpl=async url=>String(url).endsWith('/health')?{ok:true,json:async()=>({status:'ok'})}:{ok:true,json:async()=>({data:[{id:'local'}]})};
 const server=createConsoleServer({root,fetchImpl});
 try{
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'state.json'),JSON.stringify({status:'running',step:2,updatedAt:new Date().toISOString()}));
  await writeFile(join(folder,'request.json'),JSON.stringify({task:'Create local page'}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
  const headers={'content-type':'application/json','origin':'http://'+HOST+':'+PORT,'x-nexus-panel':'1'};
  const send=(route,data)=>fetch('http://'+HOST+':'+PORT+route,{method:'POST',headers,body:JSON.stringify(data)});
  const chatRes=await send('/api/chat',{message:'Hello'});assert.equal(chatRes.status,409);assert.match((await chatRes.json()).error,/single Qwen model slot/);
  const vision=await send('/api/vision',{prompt:'Hello',image:'fake'});assert.equal(vision.status,409);
  const status=await fetch('http://'+HOST+':'+PORT+'/api/status');assert.equal(status.status,200);
  const stop=await send('/api/tasks/'+id+'/stop',{});assert.equal(stop.status,200);assert.equal((await stop.json()).stopRequested,true);
 }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('three consecutive malformed tool replies stop early instead of wasting 18 model calls',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-json-early-exit-'));
 try{
  let calls=0;const states=[];
  const result=await runAgent({workspace:root,task:'Create an HTML page',generate:async()=>{calls++;return '{"tool":"write_file","args":{"path":"broken';},onEvent:async x=>states.push(x)});
  assert.equal(result.status,'needs_help');assert.match(result.reason,/three invalid tool actions/);
  assert.equal(calls,3);assert.equal(result.history.length,3);
  assert.ok(states.some(x=>x.phase==='retrying_invalid_json'));
  assert.equal(states.at(-1).status,'needs_help');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('successful tool action resets the invalid JSON retry counter',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-json-recovery-'));
 const sequence=['{',a('list_files',{path:'.'}),'{',a('finish',{message:'Verified recovery'})];
 try{
  const result=await runAgent({workspace:root,task:'Inspect the local workspace',generate:async()=>sequence.shift()});
  assert.equal(result.status,'done');assert.equal(result.history.filter(x=>x.error).length,2);
  assert.equal(result.answer,'Verified recovery');
 }finally{await rm(root,{recursive:true,force:true});}
});
