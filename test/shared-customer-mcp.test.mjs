import test from 'node:test';
import assert from 'node:assert/strict';
import {once as eventOnce} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createSharedCustomerMcpApp} from '../api/customer-board-mcp.js';
import {createCustomerMcpApp} from '../api/customer-mcp/[token].js';
import {createWorkspaceMcpApp} from '../api/workspace-mcp.js';
import {customerWorkspaceAccount,ownerWorkspaceAccount} from '../lib/workspaceAccount.js';
import {resolveCustomerAccount} from '../lib/customerWorkspaceConnection.js';
import {workspaceFixture} from './helpers/workspaceFixture.mjs';

const keyA='nxc_'+'a'.repeat(43),keyB='nxc_'+'b'.repeat(43),keyOwner='nxc_'+'o'.repeat(43);
async function connect(t,app,path='/api/customer-board-mcp'){
 const server=app.listen(0,'127.0.0.1');await eventOnce(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const client=new Client({name:'customer-isolation-test',version:'1.0.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}${path}`)));
 t.after(()=>client.close());return client;
}
function fixture(){
 const keys=new Map([[keyA,customerWorkspaceAccount('alice')],[keyB,customerWorkspaceAccount('bobby')],[keyOwner,ownerWorkspaceAccount('justin')]]);
 const records=new Map(),journal=new Map(),calls=[];
 return {keys,records,calls,options:{resolveAccount:async key=>keys.get(key)||null,loadBoard:async()=>'<html>real board resource fixture</html>',
  execute:async(action,input,account)=>{
   calls.push({action,input,account});
   assert.equal('workspace_key' in input,false,'credentials never enter product services');
   if(action==='create_event'){
    const list=records.get(account.id)||[];list.push({id:String(list.length+1),title:input.title});records.set(account.id,list);return {event:list.at(-1)};
   }
   if(action==='schedule')return {schedule:records.get(account.id)||[]};
   return {account:{id:account.id},projects:[],schedule:records.get(account.id)||[],reminders:[]};
  },
  once:async(account,id,action,input,run)=>{
   const key=account+':'+id;if(journal.has(key))return journal.get(key);
   const pending=Promise.resolve().then(run);journal.set(key,pending);return pending;
  },
 }};
}

test('one shared MCP URL advertises private-key tools without OAuth and a real board resource',async t=>{
 const f=fixture(),client=await connect(t,createSharedCustomerMcpApp(f.options));
 const {tools}=await client.listTools();
 assert.ok(tools.length>20);
 assert.equal(tools.some(tool=>tool.name==='import_form_project'),false,'owner-only demo import is not exposed');
 for(const tool of tools){assert.ok(tool.inputSchema.required.includes('workspace_key'));assert.deepEqual(tool._meta.securitySchemes,[{type:'noauth'}]);}
 const show=tools.find(tool=>tool.name==='show_nexus_board');assert.ok(show._meta.ui.resourceUri);
 const board=await client.readResource({uri:show._meta.ui.resourceUri});assert.match(board.contents[0].text,/real board resource/);
 assert.equal(f.calls.length,0,'discovery must never read account data');
});

test('parallel customers stay separate; board metadata carries the key without putting it in saved data',async t=>{
 const f=fixture(),client=await connect(t,createSharedCustomerMcpApp(f.options));
 const [a,b]=await Promise.all([keyA,keyB].map(workspace_key=>client.callTool({name:'show_nexus_board',arguments:{workspace_key}})));
 assert.equal(a.structuredContent.account.id,'customer:alice');assert.equal(b.structuredContent.account.id,'customer:bobby');
 assert.equal(a._meta.nexus_connection.workspace_key,keyA);assert.equal(b._meta.nexus_connection.workspace_key,keyB);
 assert.equal(JSON.stringify(a.structuredContent).includes(keyA),false);assert.equal(JSON.stringify(a.content).includes(keyA),false);
 await Promise.all([[keyA,'Alice event'],[keyB,'Bobby event']].map(([workspace_key,title])=>client.callTool({name:'create_nexus_event',arguments:{workspace_key,title,starts_at:'2026-10-20T10:00:00-05:00',request_id:'same-request-id'}})));
 // A retry is scoped to Alice, not Bobby's identical request ID.
 await client.callTool({name:'create_nexus_event',arguments:{workspace_key:keyA,title:'Alice event',starts_at:'2026-10-20T10:00:00-05:00',request_id:'same-request-id'}});
 const [sa,sb]=await Promise.all([keyA,keyB].map(workspace_key=>client.callTool({name:'read_nexus_schedule',arguments:{workspace_key}})));
 assert.deepEqual(sa.structuredContent.schedule,[{id:'1',title:'Alice event'}]);assert.deepEqual(sb.structuredContent.schedule,[{id:'1',title:'Bobby event'}]);
});

test('missing, invalid, revoked and owner credentials never execute; account IDs cannot override the key',async t=>{
 const f=fixture(),client=await connect(t,createSharedCustomerMcpApp(f.options));
 for(const args of [{},{workspace_key:'customer:alice'},{workspace_key:'nxc_'+'x'.repeat(43)},{workspace_key:keyOwner},{workspace_key:keyA,account_id:'justin'}]){
  const result=await client.callTool({name:'show_nexus_board',arguments:args});assert.equal(result.isError,true);
 }
 assert.equal(f.calls.length,0);
 await client.callTool({name:'show_nexus_board',arguments:{workspace_key:keyA}});assert.equal(f.calls.length,1);
 f.keys.delete(keyA);
 const result=await client.callTool({name:'show_nexus_board',arguments:{workspace_key:keyA}});assert.equal(result.isError,true);assert.equal(f.calls.length,1);
 assert.equal(JSON.stringify(result).includes(keyA),false);
});

test('customer credential resolution refuses deleted customers and operator accounts',async()=>{
 const tokens={resolve:async()=> 'alice'};
 assert.equal(await resolveCustomerAccount(keyA,{tokens,command:async()=>null}),null);
 assert.equal(await resolveCustomerAccount(keyA,{tokens:{resolve:async()=> 'Mrlopez'},command:async()=>'{"name":"owner"}'}),null);
 const account=await resolveCustomerAccount(keyA,{tokens,command:async()=>'{"guest":true}'});assert.equal(account.id,'customer:alice');assert.equal(account.owner,false);
 assert.equal(await resolveCustomerAccount('alice',{tokens:{resolve:()=>{throw Error('must not resolve guessed IDs');}}}),null);
});

test('shared credentials reach real isolated Projects, Schedule and Reminders stores',async t=>{
 const store=workspaceFixture();
 const client=await connect(t,createSharedCustomerMcpApp({...store,resolveAccount:async key=>key===keyA?customerWorkspaceAccount('alice'):key===keyB?customerWorkspaceAccount('bobby'):null}));
 const call=(workspace_key,name,input={})=>client.callTool({name,arguments:{...input,workspace_key}});
 const htmlA='<!doctype html><html><body>Alice project</body></html>',htmlB='<!doctype html><html><body>Bobby project</body></html>';
 const saved=await call(keyA,'save_nexus_project',{project_id:'shared-name',html:htmlA,label:'Alice project',request_id:'same-save-1234'});assert.notEqual(saved.isError,true);
 const foreign=await call(keyB,'read_nexus_project',{project_id:'shared-name'});assert.equal(foreign.isError,true);
 await call(keyB,'save_nexus_project',{project_id:'shared-name',html:htmlB,label:'Bobby project',request_id:'same-save-1234'});
 assert.equal((await call(keyA,'read_nexus_project',{project_id:'shared-name'})).structuredContent.html,htmlA);
 assert.equal((await call(keyB,'read_nexus_project',{project_id:'shared-name'})).structuredContent.html,htmlB);
 await call(keyA,'create_nexus_event',{title:'Alice workout',starts_at:'2099-10-20T10:00:00-05:00',request_id:'real-event-1234'});
 await call(keyB,'create_nexus_reminder',{title:'Bobby task',request_id:'real-task-12345'});
 assert.equal((await call(keyA,'read_nexus_schedule')).structuredContent.items.length,1);
 assert.equal((await call(keyB,'read_nexus_schedule')).structuredContent.items.length,0);
 assert.ok((await call(keyA,'read_nexus_reminders')).structuredContent.items.every(item=>item.title==='Alice workout'),'Alice may see her calendar reminder, never Bobby\'s task');
 assert.equal((await call(keyB,'read_nexus_reminders')).structuredContent.items[0].title,'Bobby task');
 assert.equal((await call(keyA,'get_nexus_usage')).structuredContent.usage.exempt,false);
});

test('legacy private URL and owner OAuth tools retain their original schemas',async t=>{
 const f=fixture();
 const old=await connect(t,createCustomerMcpApp(f.options),'/api/customer-mcp/'+keyA);
 const legacyTools=(await old.listTools()).tools;
 assert.equal('workspace_key' in legacyTools.find(x=>x.name==='show_nexus_board').inputSchema.properties,false);
 const owner=await connect(t,createWorkspaceMcpApp({loadBoard:f.options.loadBoard}));
 const ownerTools=(await owner.listTools()).tools;
 assert.equal('workspace_key' in ownerTools.find(x=>x.name==='show_nexus_board').inputSchema.properties,false);
 assert.equal(ownerTools.find(x=>x.name==='show_nexus_board')._meta.securitySchemes[0].type,'oauth2');
});
