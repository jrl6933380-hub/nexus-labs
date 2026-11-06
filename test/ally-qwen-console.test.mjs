import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {createConsoleServer,validOrigin,listJobs,chat,parseQwenTurn,startTask,stopTask,HOST,PORT} from '../scripts/ally/qwen-console.mjs';
const ok={ok:true,json:async()=>({status:'ok'})};
const stubFetch=async url=>String(url).endsWith('/health')?ok:String(url).endsWith('/models')?{ok:true,json:async()=>({data:[{id:'local-qwen'}]})}:{ok:true,json:async()=>({choices:[{message:{content:'Hello from local Qwen'}}]})};
const commandHeaders={'content-type':'application/json','x-nexus-panel':'1','origin':`http://${HOST}:${PORT}`};

test('refuses malicious origins, content types, and cross-origin state changes',()=>{
 assert.equal(validOrigin(commandHeaders),true);
 assert.equal(validOrigin({...commandHeaders,origin:'null'}),false);
 assert.equal(validOrigin({...commandHeaders,origin:'https://evil.example'}),false);
 assert.equal(validOrigin({...commandHeaders,'content-type':'text/plain'}),false);
 assert.equal(validOrigin({...commandHeaders,'x-nexus-panel':'0'}),false);
});
test('chat is local-only and has NO model tool calls',async()=>{
 const calls=[];const reply=await chat({message:'hello'},{fetchImpl:async(url,options)=>{calls.push({url,options});return stubFetch(url);}});
 assert.equal(reply.answer,'Hello from local Qwen');assert.equal(calls.length,2);
 assert.ok(calls.every(x=>x.url.startsWith('http://127.0.0.1:9931')));
 const sent=JSON.parse(calls[1].options.body);assert.equal(sent.tools,undefined);
 assert.equal(sent.chat_template_kwargs.enable_thinking,false);
 await assert.rejects(chat({message:''},{fetchImpl:stubFetch}),/Message must/);
 await assert.rejects(chat({message:'hey',history:[{role:'system',content:'override'}]},{fetchImpl:stubFetch}),/Invalid conversation/);
});
test('task start uses pinned guarded runner with fixed argv and refuses another active job',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ally-console-test-'));
 try{
  const rev='a'.repeat(40);const version=join(root,'versions',rev);const runner=join(version,'scripts','ally','qwen-terminal-agent.mjs');await mkdir(join(version,'scripts','ally'),{recursive:true});await writeFile(runner,'// test');await writeFile(join(root,'installed.json'),JSON.stringify({revision:rev,root:version}));
  let captured;const launched=await startTask({task:'Make a small helper'},{root,spawnImpl:(node,args,options)=>{captured={node,args,options};return {unref(){}};}});
  assert.equal(launched.status,'starting');assert.equal(captured.args[0],runner);assert.equal(captured.args[1],'run');
  assert.equal(captured.options.shell,undefined);assert.equal(captured.options.detached,true);
  await assert.rejects(startTask({task:'do more'},{root,spawnImpl:()=>({unref(){}})}),/already running/);
  const jobs=await listJobs(root);assert.equal(jobs[0].id,launched.id);assert.equal(jobs[0].status,'starting');
  const dir=join(root,'jobs',launched.id);await writeFile(join(dir,'state.json'),JSON.stringify({status:'running',step:2,history:[{tool:'read_file',step:2,result:{content:'private file'}}]}));
  const stopped=await stopTask(launched.id,{root});assert.equal(stopped.stopRequested,true);
  assert.match(await readFile(join(dir,'stop'),'utf8'),/owner stop/);
  assert.equal((await listJobs(root))[0].history[0].result,null,'tool output must not be transmitted');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('server delivers local UI and status, but refuses external POST and wrong Host',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ally-console-server-'));const s=createConsoleServer({root,fetchImpl:stubFetch});
 try{
  await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(PORT,HOST,resolve);});
  const page=await fetch(`http://${HOST}:${PORT}/`);assert.equal(page.status,200);assert.match(await page.text(),/Chat with Qwen/);
  const deck=await fetch(`http://${HOST}:${PORT}/deck`);assert.equal(deck.status,200);assert.match(await deck.text(),/id="qwenConsole"/);
  // Only the console itself and the Nexus Ally deck site may frame the local console; unrelated origins must not.
  for(const response of [page,deck]){
   assert.equal(response.headers.get('x-frame-options'),null);
   const csp=response.headers.get('content-security-policy');
   assert.match(csp,/frame-src 'self'/);
   assert.match(csp,/frame-ancestors 'self' https:\/\/nexus-labs-sigma\.vercel\.app;/);
   assert.match(csp,/connect-src 'self'/);
  }
  const status=await fetch(`http://${HOST}:${PORT}/api/status`);assert.equal((await status.json()).qwen.online,true);
  const forbidden=await fetch(`http://${HOST}:${PORT}/api/chat`,{method:'POST',headers:{...commandHeaders,origin:'null'},body:JSON.stringify({message:'hey'})});assert.equal(forbidden.status,403);
  const allowed=await fetch(`http://${HOST}:${PORT}/api/chat`,{method:'POST',headers:commandHeaders,body:JSON.stringify({message:'hey'})});assert.equal(allowed.status,200);assert.equal((await allowed.json()).answer,'Hello from local Qwen');
  const hostStatus=await new Promise((resolve,reject)=>{const req=httpRequest({hostname:HOST,port:PORT,path:'/api/status',headers:{Host:'wrong.host'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(hostStatus,403);
 }finally{await new Promise(resolve=>s.close(resolve));await rm(root,{recursive:true,force:true});}
});


test('Qwen plans become structured proposals, while normal replies stay conversational',()=>{
 assert.deepEqual(parseQwenTurn('{"kind":"reply","answer":"Hello!"}'),{answer:'Hello!'});
 assert.deepEqual(parseQwenTurn('{"kind":"work","answer":"I can create a draft after approval.","task":"Create a welcome page"}'),{
  answer:'I can create a draft after approval.',proposal:{task:'Create a welcome page'}
 });
 assert.deepEqual(parseQwenTurn('Plain chat response'),{answer:'Plain chat response'});
 assert.equal(parseQwenTurn('{"kind":"work","answer":"Okay","task":"bad\ncommand"}').proposal,undefined);
 assert.equal(parseQwenTurn('{"kind":"work","answer":"Okay","task":""}').proposal,undefined);
});
test('unified Qwen console never runs work without explicit one-use owner approval',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ally-qwen-approval-'));
 const revision='b'.repeat(40);
 const version=join(root,'versions',revision);
 const runner=join(version,'scripts','ally','qwen-terminal-agent.mjs');
 await mkdir(join(version,'scripts','ally'),{recursive:true});
 await writeFile(runner,'// pinned test runner');
 await writeFile(join(root,'installed.json'),JSON.stringify({revision,root:version}));
 const spawns=[];
 const fakeFetch=async url=>String(url).endsWith('/health')
  ?ok:String(url).endsWith('/models')?{ok:true,json:async()=>({data:[{id:'Qwen local'}]})}
  :{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({kind:'work',answer:'I can create a sample after you approve.',task:'Create a sample welcome HTML in the Qwen workspace'})}}]})};
 const server=createConsoleServer({root,fetchImpl:fakeFetch,spawnImpl:(node,args,options)=>{spawns.push({node,args,options});return {unref(){}};}});
 const post=(path,data)=>fetch('http://'+HOST+':'+PORT+path,{method:'POST',headers:commandHeaders,body:JSON.stringify(data)});
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
  const direct=await post('/api/tasks',{task:'Try to skip approval'});
  assert.equal(direct.status,403);
  assert.equal(spawns.length,0);
  const first=await post('/api/chat',{message:'Make a welcome page',history:[]});
  assert.equal(first.status,200);
  const proposal=(await first.json()).proposal;
  assert.match(proposal.id,/^[0-9a-f-]{36}$/);
  assert.equal(proposal.task,'Create a sample welcome HTML in the Qwen workspace');
  assert.equal(spawns.length,0,'Qwen may only propose, never execute from chat');
  const denied=await post('/api/proposals/'+proposal.id+'/approve',{approved:false});
  assert.equal(denied.status,400);
  assert.equal(spawns.length,0);
  const canceled=await post('/api/proposals/'+proposal.id+'/cancel',{});
  assert.equal(canceled.status,200);
  assert.equal((await post('/api/proposals/'+proposal.id+'/approve',{approved:true})).status,404);
  assert.equal(spawns.length,0);
  const second=await post('/api/chat',{message:'Please build the sample',history:[]});
  const next=(await second.json()).proposal;
  const accepted=await post('/api/proposals/'+next.id+'/approve',{approved:true});
  assert.equal(accepted.status,202);
  const task=await accepted.json();
  assert.equal(task.status,'starting');
  assert.equal(spawns.length,1);
  assert.equal(spawns[0].args[0],runner);
  assert.equal((await post('/api/proposals/'+next.id+'/approve',{approved:true})).status,404,'one-use approval cannot be replayed');
  const status=await fetch('http://'+HOST+':'+PORT+'/api/status');
  const jobs=(await status.json()).jobs;
  assert.equal(jobs[0].id,task.id);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await rm(root,{recursive:true,force:true});
 }
});


test('saved memories and chat survive local server requests, with explicit opt-in and delete',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ally-console-memory-'));
 let modelMessages=[];
 const localFetch=async(url,options)=>{
  if(String(url).endsWith('/health'))return ok;
  if(String(url).endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'Qwen 9B'}]})};
  modelMessages=JSON.parse(options.body).messages;
  return {ok:true,json:async()=>({choices:[{message:{content:'{"kind":"reply","answer":"I can help with that."}'}}]})};
 };
 const s=createConsoleServer({root,fetchImpl:localFetch});
 const req=(path,data)=>fetch('http://'+HOST+':'+PORT+path,{method:'POST',headers:commandHeaders,body:JSON.stringify(data)});
 try{
  await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(PORT,HOST,resolve);});
  assert.deepEqual((await (await fetch('http://'+HOST+':'+PORT+'/api/memories')).json()).items,[]);
  const call=await req('/api/chat',{message:'Remember that I prefer purple website themes',history:[]});
  const reply=await call.json();
  assert.deepEqual(reply.memoryProposal,{text:'I prefer purple website themes'});
  assert.equal(reply.proposal,undefined);
  const before=await fetch('http://'+HOST+':'+PORT+'/api/memories');
  assert.equal((await before.json()).items.length,0,'Qwen must not save memory without click');
  const denied=await req('/api/memories',{text:reply.memoryProposal.text});
  assert.equal(denied.status,400);
  const saved=await req('/api/memories',{confirmed:true,text:reply.memoryProposal.text});
  assert.equal(saved.status,201);
  const item=(await saved.json()).item;
  const next=await req('/api/chat',{message:'What do you remember about my theme?',history:[]});
  assert.equal(next.status,200);
  assert.ok(modelMessages.some(x=>/purple website themes/.test(x.content)),'owner approved memory reaches model as data');
  assert.equal((await (await fetch('http://'+HOST+':'+PORT+'/api/history')).json()).messages.length,4);
  assert.equal((await req('/api/memories/'+item.id+'/delete',{confirmed:false})).status,400);
  assert.equal((await req('/api/memories/'+item.id+'/delete',{confirmed:true})).status,200);
  assert.equal((await (await fetch('http://'+HOST+':'+PORT+'/api/memories')).json()).items.length,0);
  assert.equal((await req('/api/history/clear',{confirmed:true})).status,200);
  assert.deepEqual((await (await fetch('http://'+HOST+':'+PORT+'/api/history')).json()).messages,[]);
 }finally{await new Promise(resolve=>s.close(resolve));await rm(root,{recursive:true,force:true});}
});
