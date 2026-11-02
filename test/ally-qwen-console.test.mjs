import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {createConsoleServer,validOrigin,listJobs,chat,startTask,stopTask,HOST,PORT} from '../scripts/ally/qwen-console.mjs';
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
  const page=await fetch(`http://${HOST}:${PORT}/`);assert.equal(page.status,200);assert.match(await page.text(),/Qwen Control Console/);
  const deck=await fetch(`http://${HOST}:${PORT}/deck`);assert.equal(deck.status,200);assert.match(await deck.text(),/id="qwenConsole"/);
  const status=await fetch(`http://${HOST}:${PORT}/api/status`);assert.equal((await status.json()).qwen.online,true);
  const forbidden=await fetch(`http://${HOST}:${PORT}/api/chat`,{method:'POST',headers:{...commandHeaders,origin:'null'},body:JSON.stringify({message:'hey'})});assert.equal(forbidden.status,403);
  const allowed=await fetch(`http://${HOST}:${PORT}/api/chat`,{method:'POST',headers:commandHeaders,body:JSON.stringify({message:'hey'})});assert.equal(allowed.status,200);assert.equal((await allowed.json()).answer,'Hello from local Qwen');
  const hostStatus=await new Promise((resolve,reject)=>{const req=httpRequest({hostname:HOST,port:PORT,path:'/api/status',headers:{Host:'wrong.host'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(hostStatus,403);
 }finally{await new Promise(resolve=>s.close(resolve));await rm(root,{recursive:true,force:true});}
});
