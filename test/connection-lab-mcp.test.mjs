import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createConnectionLabMcpApp,LAB_BOARD_URI} from '../api/connection-lab-mcp.js';

const html=readFileSync(new URL('../public/connection-lab-board.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function environment(t){
 let count=0;
 const server=createConnectionLabMcpApp({now:()=> '2026-10-16T00:00:00.000Z',id:()=> 'response-'+(++count)}).listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const client=new Client({name:'fresh-connection-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/api/connection-lab-mcp')));t.after(()=>client.close());
 return {client,base};
}
function ui({callTool,toolOutput,standard=false}={}){
 const nodes=new Map(),events={},calls=[];
 const by=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:true,dataset:{}});return nodes.get(id);};
 const parent={postMessage(msg){
  if(msg.id===undefined)return;
  const response=msg.method==='ui/initialize'?Promise.resolve({protocolVersion:'2026-01-26',hostInfo:{name:'fixture',version:'1.0.0'},hostCapabilities:{},hostContext:{}}):Promise.resolve().then(()=>callTool(msg.params.name,msg.params.arguments));
  response.then(result=>events.message({source:parent,data:{jsonrpc:'2.0',id:msg.id,result}}));
 }};
 const context={document:{getElementById:by},crypto:{randomUUID:()=> 'challenge-for-this-click'},setTimeout,clearTimeout,window:{parent,addEventListener:(name,callback)=>events[name]=callback,...(standard?{}:{openai:{toolOutput,callTool:async(name,args)=>{calls.push({name,args});return callTool(name,args);}}})}};
 vm.runInNewContext(script,context);return {by,events,parent,calls};
}

test('fresh server exposes only the two isolated no-login tools and its board',async t=>{
 const {client,base}=await environment(t),tools=(await client.listTools()).tools;
 assert.deepEqual(tools.map(t=>t.name).sort(),['refresh_connection_test_board','show_connection_test_board']);
 for(const tool of tools){assert.deepEqual(tool._meta.securitySchemes,[{type:'noauth'}]);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.ok(tool.outputSchema);}
 assert.equal(tools.find(t=>t.name==='show_connection_test_board')._meta.ui.resourceUri,LAB_BOARD_URI);
 const resource=await client.readResource({uri:LAB_BOARD_URI});assert.equal(resource.contents[0].text,html);assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains,[]);
 const response=await fetch(base+'/api/connection-lab-mcp');assert.equal(response.status,405);assert.match(response.headers.get('cache-control'),/no-store/);
});

test('server produces fresh receipts and echoes only a bounded test challenge',async t=>{
 const {client}=await environment(t);
 const a=await client.callTool({name:'show_connection_test_board',arguments:{}}),b=await client.callTool({name:'show_connection_test_board',arguments:{}});
 assert.equal(a.structuredContent.source,'nexus-connection-lab');assert.equal(a.structuredContent.test_only,true);assert.equal(a.structuredContent.challenge,null);assert.notEqual(a.structuredContent.response_id,b.structuredContent.response_id);
 const roundtrip=await client.callTool({name:'refresh_connection_test_board',arguments:{challenge:'unique-test-challenge'}});assert.equal(roundtrip.structuredContent.challenge,'unique-test-challenge');
 for(const args of [{},{challenge:'x'},{challenge:'x'.repeat(81)},{challenge:'valid-challenge',owner:'justin'}])assert.equal((await client.callTool({name:'refresh_connection_test_board',arguments:args})).isError,true);
 assert.equal((await client.callTool({name:'show_nexus_board',arguments:{}})).isError,true,'existing Nexus tool names are not available');
});

test('actual widget button makes a real MCP round trip through the ChatGPT bridge',async t=>{
 const {client}=await environment(t),initial=await client.callTool({name:'show_connection_test_board',arguments:{}});
 const h=ui({toolOutput:initial.structuredContent,callTool:(name,args)=>client.callTool({name,arguments:args})});
 assert.match(h.by('status').textContent,/Live server response received/);assert.notEqual(h.by('status').dataset.state,'ok');
 await h.by('verify').onclick();assert.equal(h.calls[0].name,'refresh_connection_test_board');assert.equal(h.by('challenge').textContent,'challenge-for-this-click');assert.equal(h.by('status').textContent,'Live round trip verified.');assert.equal(h.by('status').dataset.state,'ok');assert.equal(h.by('verify').disabled,false);
});

test('standard MCP Apps bridge also completes the real round trip',async t=>{
 const {client}=await environment(t),h=ui({standard:true,callTool:(name,args)=>client.callTool({name,arguments:args})});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.by('verify').disabled,false);
 await h.by('verify').onclick();assert.equal(h.by('status').dataset.state,'ok');
});

test('wrong echoes and failed tools never display a successful round trip',async()=>{
 for(const callTool of [async()=>({isError:true}),async()=>({structuredContent:{source:'nexus-connection-lab',test_only:true,server_time:'now',response_id:'wrong',challenge:'another-click'}}),async()=>{throw new Error('Connection lost.');}]){
  const h=ui({callTool});await h.by('verify').onclick();assert.equal(h.by('status').dataset.state,'error');assert.equal(h.by('verify').disabled,false);
 }
});

test('widget ignores messages from outside its parent host',()=>{
 const h=ui({callTool:async()=>({})});
 h.events.message({source:{},data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{source:'nexus-connection-lab',test_only:true,server_time:'injected',response_id:'injected'}}}});
 assert.notEqual(h.by('time').textContent,'injected');
});
