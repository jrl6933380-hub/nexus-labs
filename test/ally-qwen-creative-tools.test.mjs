import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeTool,runAgent,INSTRUCTIONS} from '../scripts/ally/qwen-terminal-agent.mjs';
import {workCatalog,macroHandoff,googleSearchUrl,searchPublicGoogle} from '../scripts/ally/qwen-work-tools.mjs';
import {previewSiteHtml,createConsoleServer,HOST,PORT} from '../scripts/ally/qwen-console.mjs';

test('Qwen exposes every verified Macro Controller workflow without executing owner-only actions',async()=>{
 const catalog=workCatalog(),names=catalog.macros.map(m=>m.id);
 assert.equal(catalog.permissions.github,'not_available');
 assert.equal(catalog.permissions.nexus_production,'not_available');
 assert.equal(catalog.permissions.arbitrary_terminal,'not_available');
 assert.equal(catalog.permissions.publishing,'not_available');
 assert.equal(names.length,9);
 for(const name of ['start-ad','preview-ad','ad-variations','package-ad','render-ad','submit-for-review','revise-ad','approved-to-board','video-to-board']){
  assert.ok(names.includes(name),name);
 }
 assert.equal(catalog.macros.find(m=>m.id==='render-ad').runLocally,false);
 assert.equal(catalog.macros.find(m=>m.id==='video-to-board').runLocally,false);
 assert.equal(catalog.macros.find(m=>m.id==='start-ad').runLocally,true);
 let called=0;
 const space=await mkdtemp(join(tmpdir(),'qwen-tools-'));
 try{
  const local=await executeTool({tool:'macro_catalog',args:{}},{workspace:space,commandRunner:()=>{called++;}});
  assert.equal(local.macros.length,9);
  const handoff=await executeTool({tool:'macro_handoff',args:{id:'approved-to-board'}},{workspace:space,commandRunner:()=>{called++;}});
  assert.equal(handoff.ownerActionRequired,true);
  assert.equal(handoff.executed,false);
  assert.match(handoff.link,/^https:\/\/nexus-labs-sigma\.vercel\.app\//);
  await assert.rejects(executeTool({tool:'macro_handoff',args:{id:'unverified-anything'}},{workspace:space}),/not in the verified/);
  assert.equal(called,0,'listing and handoffs never invoke a macro');
 }finally{await rm(space,{recursive:true,force:true});}
});

test('public search is generated Google-only, has fixed PowerShell args and filters captured links',async()=>{
 const url=googleSearchUrl('barbers in Des Moines','ai');
 assert.match(url,/^https:\/\/www\.google\.com\/search\?/);
 assert.match(url,/udm=50/);
 assert.throws(()=>googleSearchUrl('barbers','post'),/Google search/);
 assert.throws(()=>googleSearchUrl(' '),/Google search/);
 const space=await mkdtemp(join(tmpdir(),'qwen-search-'));
 const seen=[];
 const commandRunner=async(file,args,opts)=>{
  seen.push({file,args,opts});
  const action=args[args.indexOf('-Action')+1];
  if(action==='Open')return {stdout:JSON.stringify({opened:true})};
  return {stdout:JSON.stringify({
   found:true,text:'Search results contain public business names, service categories and websites. '.repeat(4)+'Contact: user@example.com',
   links:[{name:'Example Business',url:'https://example.org/business'},{name:'Unsafe local',url:'http://127.0.0.1/test'},{name:'JS',url:'javascript:alert(1)'}],
   captured_at:'2026-11-06T00:00:00.000Z'
  })};
 };
 try{
  const r=await executeTool({tool:'web_search',args:{query:'barbers Des Moines',mode:'search'}},{
   workspace:space,commandRunner,sleep:async()=>{}
  });
  assert.equal(r.status,'results');
  assert.equal(seen.length,2);
  for(const call of seen){
   assert.equal(call.file,'powershell.exe');assert.equal(call.opts.shell,false);
   assert.match(call.args.at(-1),/^https:\/\/www\.google\.com\/search\?/);
   assert.match(call.args[call.args.indexOf('-File')+1],/forge-browser\.ps1$/);
  }
  assert.equal(r.links.length,1);assert.equal(r.links[0].url,'https://example.org/business');
  assert.doesNotMatch(r.text,/user@example.com/);
  assert.match(r.notice,/unverified/);
  assert.match(INSTRUCTIONS,/Never use GitHub/);
  assert.doesNotMatch(INSTRUCTIONS,/git_status|git_diff_stat|git_log/);
 }finally{await rm(space,{recursive:true,force:true});}
});

test('unavailable public Google capture becomes needs_help, never invented research',async()=>{
 const r=await searchPublicGoogle({query:'search term'},{
  scriptDir:'/tmp/fixed',
  sleep:async()=>{},
  runner:async(file,args)=>{
   const action=args[args.indexOf('-Action')+1];
   return {stdout:JSON.stringify(action==='Open'?{opened:true}:{found:false})};
  }
 });
 assert.equal(r.status,'needs_help');
 assert.equal(r.query,'search term');assert.equal(r.links,undefined);
});

test('local HTML previews are isolated and filesystem traversal is denied',async()=>{
 const space=await mkdtemp(join(tmpdir(),'qwen-preview-'));const outside=await mkdtemp(join(tmpdir(),'qwen-outside-'));
 try{
  await mkdir(join(space,'sites','my-site'),{recursive:true});
  await writeFile(join(space,'sites','my-site','index.html'),'<!doctype html><html><body><h1>Demo</h1><script>alert(1)</script></body></html>');
  await writeFile(join(outside,'secret.html'),'<html>PRIVATE</html>');
  const result=await previewSiteHtml('sites/my-site/index.html',{workspace:space});
  assert.match(result.html,/script-src 'none'/);
  assert.match(result.html,/connect-src 'none'/);
  assert.match(result.html,/default-src 'none'/);
  assert.match(result.html,/Demo/);
  await assert.rejects(previewSiteHtml('../secret.html',{workspace:space}),/Unsafe|Path|Outside/);
  await assert.rejects(previewSiteHtml(join(outside,'secret.html'),{workspace:space}),/Path/);
  await assert.rejects(previewSiteHtml('secret.js',{workspace:space}),/local HTML/);
 }finally{await rm(space,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('local-only console exposes tools and serves script-disabled site preview to its own UI',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-ui-tools-'));
 const workspace=join(root,'workspace');await mkdir(workspace,{recursive:true});
 await writeFile(join(workspace,'index.html'),'<h1>Local</h1>');
 const server=createConsoleServer({root,workspace,fetchImpl:async()=>({ok:false})});
 const headers={'content-type':'application/json','x-nexus-panel':'1','origin':'http://'+HOST+':'+PORT};
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
  const tools=await fetch('http://'+HOST+':'+PORT+'/api/tools');
  assert.equal(tools.status,200);
  assert.equal((await tools.json()).permissions.github,'not_available');
  const page=await fetch('http://'+HOST+':'+PORT+'/');
  const html=await page.text();
  assert.match(html,/id="siteFrame"[^>]*sandbox=""/);
  assert.match(html,/Tools & Macro Controller/);
  const forbidden=await fetch('http://'+HOST+':'+PORT+'/api/site-preview',{method:'POST',headers:{...headers,origin:'null'},body:JSON.stringify({path:'index.html'})});
  assert.equal(forbidden.status,403);
  const allowed=await fetch('http://'+HOST+':'+PORT+'/api/site-preview',{method:'POST',headers,body:JSON.stringify({path:'index.html'})});
  assert.equal(allowed.status,200);
  const data=await allowed.json();assert.match(data.html,/script-src 'none'/);
  const blocked=await fetch('http://'+HOST+':'+PORT+'/api/site-preview',{method:'POST',headers,body:JSON.stringify({path:'../bad.html'})});
  assert.equal(blocked.status,400);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});


test('Qwen cannot claim a completed search when the visible Google browser is unavailable',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'qwen-search-fail-'));
 const queue=[
  {tool:'set_plan',args:{steps:['Find reliable public results']}},
  {tool:'web_search',args:{query:'nearby business opportunities',mode:'search'}},
  {tool:'update_step',args:{id:1,status:'done'}},
  {tool:'finish',args:{message:'Results found'}}
 ];
 const runner=async(file,args)=>{
  const action=args[args.indexOf('-Action')+1];
  return {stdout:JSON.stringify(action==='Open'?{opened:true}:{found:false})};
 };
 try{
  const result=await runAgent({
   task:'Research public business opportunities',workspace,
   generate:async()=>JSON.stringify(queue.shift()),
   execute:(action,ctx)=>executeTool(action,{...ctx,commandRunner:runner,sleep:async()=>{}})
  });
  assert.equal(result.status,'needs_help');
  assert.equal(result.plan[0].status,'pending');
  assert.equal(queue.length,2,'runner stops before model can falsely mark task done');
 }finally{await rm(workspace,{recursive:true,force:true});}
});
