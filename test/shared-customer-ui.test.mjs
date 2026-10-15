import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const key='nxc_'+'a'.repeat(43);
const landing=readFileSync(new URL('../public/connect.html',import.meta.url),'utf8');
const board=readFileSync(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8');

async function landingHarness(shared){
 const nodes=new Map(),requests=[];
 const element=()=>({hidden:false,value:'',textContent:'',style:{},classList:{add(){},remove(){}},handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){},appendChild(){}});
 const by=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context={URLSearchParams,location:{search:shared?'?shared=1':''},document:{getElementById:by,createElement:element},window:{},navigator:{},fetch:async(_url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  return {ok:true,json:async()=>body.revoke?{ok:true,revoked:true}:body.shared?{ok:true,workspace_key:key,shared_mcp_url:'https://nexus.test/api/customer-board-mcp'}:{ok:true,mcp_url:'https://nexus.test/api/customer-mcp/'+key}};
 }};
 vm.runInNewContext(landing.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 await new Promise(resolve=>setImmediate(resolve));return {by,requests};
}

test('shared landing hands off the private key without asking Plugin Creator to create an app',async()=>{
 const h=await landingHarness(true);
 assert.equal(h.requests[0].shared,true);
 const prompt=new URL(h.by('go').href).searchParams.get('prompt');
 assert.ok(prompt.includes(key));assert.match(prompt,/shared Nexus customer app/);assert.doesNotMatch(prompt,/@Plugin Creator|Authentication:|MCP endpoint:/);
 assert.match(h.by('need').textContent,/Enable the shared Nexus customer app/);assert.equal(h.by('go').hidden,false);
 await h.by('revoke').handlers.click();assert.equal(h.by('go').hidden,true);assert.equal(h.by('prompt').value,'');
});

test('default private-URL signup remains available',async()=>{
 const h=await landingHarness(false);
 assert.equal(h.requests[0].shared,undefined);
 assert.match(new URL(h.by('go').href).searchParams.get('prompt'),/@Plugin Creator/);
});

function boardHarness(initialKey){
 const calls=[],events={};
 const context={window:{openai:{toolResponseMetadata:initialKey?{nexus_connection:{workspace_key:initialKey}}:undefined,callTool:async(name,args)=>{calls.push({name,args});return {structuredContent:{saved:true}};}},addEventListener:(name,fn)=>events[name]=fn},hostReady:false,render(){},hostLayout(){},answerUpdate(){return false;},reloadBoardAnswers:null,pending:new Map(),clearTimeout(){}};
 const connection=board.slice(board.indexOf('let workspaceKey='),board.indexOf('let focusBoard='));
 const tool=board.slice(board.indexOf('async function tool('),board.indexOf('async function message('));
 vm.runInNewContext(connection+tool,context);
 for(const line of board.split('\n').filter(line=>line.startsWith("window.addEventListener('openai:set_globals'") || line.startsWith("window.addEventListener('message'")))vm.runInNewContext(line,context);
 return {context,calls,events};
}

test('real board bridge attaches widget-only credential to refresh and write buttons',async()=>{
 const h=boardHarness(key);
 await vm.runInNewContext("tool('read_nexus_workspace')",h.context);
 await vm.runInNewContext("tool('create_nexus_reminder',{title:'My task',request_id:'task-12345'})",h.context);
 assert.equal(h.calls[0].args.workspace_key,key);assert.equal(h.calls[1].args.workspace_key,key);assert.equal(h.calls[1].args.title,'My task');
});

test('late ChatGPT and standard MCP result metadata both scope board button calls',async()=>{
 const h=boardHarness();
 h.events['openai:set_globals']({detail:{globals:{toolResponseMetadata:{nexus_connection:{workspace_key:key}}}}});
 await vm.runInNewContext("tool('read_nexus_workspace')",h.context);assert.equal(h.calls.at(-1).args.workspace_key,key);
 const otherKey='nxc_'+'b'.repeat(43);h.context.window.parent={};
 h.events.message({source:h.context.window.parent,data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{_meta:{nexus_connection:{workspace_key:otherKey}}}}});
 await vm.runInNewContext("tool('read_nexus_workspace')",h.context);assert.equal(h.calls.at(-1).args.workspace_key,otherKey);
});

test('owner and legacy board controls do not acquire customer credential parameters',async()=>{
 const h=boardHarness();await vm.runInNewContext("tool('read_nexus_workspace')",h.context);
 assert.equal('workspace_key' in h.calls[0].args,false);
});
