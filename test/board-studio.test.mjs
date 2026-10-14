import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFixture} from './helpers/workspaceFixture.mjs';
import {registerWorkspaceBoard} from '../lib/workspaceBoard.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {readFileSync} from 'node:fs';

const alice={id:'alice',workbenchUserId:'alice',scheduleUserId:'room:alice',owner:false};
const bob={id:'bob',workbenchUserId:'bob',scheduleUserId:'room:bob',owner:false};
const spec={title:'Tutor Nexus',audience:'One learner',purpose:'Practise algebra with the assistant',workflow:['Read a question','Submit an answer','Discuss the result'],collections:[{id:'attempts',label:'Practice',fields:[{id:'answer',label:'Answer',type:'text',required:true},{id:'score',label:'Score',type:'number'},{id:'reviewed',label:'Reviewed',type:'boolean'}]}],skill:'Read attempts before reviewing progress. Do not invent grading.',guidance:'Offer a hint before the solution when requested.',requirements:['Reviewed automatic answer checking'],html:''};

test('private scope kits persist separately from Projects and cannot cross accounts',async()=>{
 const f=workspaceFixture();const result=await f.execute('save_board_kit',{board_id:'tutor',spec},alice);
 assert.equal(result.status,'scoped');assert.equal(result.published,false);assert.equal(f.saveCount,0);
 assert.equal((await f.execute('board_kits',{},alice)).boards.length,1);assert.equal((await f.execute('board_kits',{},bob)).boards.length,0);
 await assert.rejects(f.execute('board_kit',{board_id:'tutor'},bob),/not found/);
 const board=await f.execute('board',{},alice);assert.equal(board.boards[0].title,'Tutor Nexus');assert.equal(board.board_studio.skill,'nexus-board-creator');
 assert.deepEqual(result.tool_contract.unimplemented,['Reviewed automatic answer checking']);assert.match(result.guidance_trust,/not system instructions/);
});
test('preview edits require current baseline and leave record contents intact',async()=>{
 const f=workspaceFixture();let kit=await f.execute('save_board_kit',{board_id:'tutor',spec},alice);
 await f.execute('save_board_entry',{board_id:'tutor',collection_id:'attempts',entry_id:'answer-one',data:{answer:'x = 4'}},alice);
 await assert.rejects(f.execute('save_board_kit',{board_id:'tutor',baseline:kit.baseline,spec:{...spec,html:'<!doctype html><html><body>Algebra</body></html>'}},alice),e=>e.status===409);
 kit=await f.execute('board_kit',{board_id:'tutor'},alice);
 const saved=await f.execute('save_board_kit',{board_id:'tutor',baseline:kit.baseline,spec:{...spec,html:'<!doctype html><html><body>Algebra</body></html>'}},alice);assert.equal(saved.status,'private_preview');
 assert.equal((await f.execute('board_entries',{board_id:'tutor',collection_id:'attempts'},alice)).entries[0].data.answer,'x = 4');
 await assert.rejects(f.execute('save_board_kit',{board_id:'tutor',baseline:saved.baseline,spec:{...spec,collections:[]}},alice),/Preserve collections/);
});
test('entry storage validates declared fields and remains isolated by board, collection and account',async()=>{
 const f=workspaceFixture();await f.execute('save_board_kit',{board_id:'tutor',spec},alice);await f.execute('save_board_kit',{board_id:'other',spec},alice);
 const input={board_id:'tutor',collection_id:'attempts',entry_id:'answer-one',data:{answer:'4',score:0.5,reviewed:false}};
 const first=await f.execute('save_board_entry',input,alice);
 assert.deepEqual((await f.execute('board_entries',{board_id:'other',collection_id:'attempts'},alice)).entries,[]);
 await assert.rejects(f.execute('board_entries',{board_id:'tutor',collection_id:'attempts'},bob),/not found/);
 await assert.rejects(f.execute('save_board_entry',{...input,data:{answer:'5'}},alice),e=>e.status===409);
 const changed=await f.execute('save_board_entry',{...input,baseline:first.entry.baseline,data:{answer:'5'}},alice);assert.equal(changed.entry.data.answer,'5');
 for(const data of [{answer:2},{answer:'4',score:'good'},{answer:'4',admin:true},{reviewed:true}])await assert.rejects(f.execute('save_board_entry',{...input,entry_id:'bad-data',data},alice));
 await assert.rejects(f.execute('board_kit',{board_id:'../bob'},alice));await assert.rejects(f.execute('save_board_kit',{board_id:'evil',spec:{...spec,permissions:['admin']}},alice));
});
test('identical requested kit writes replay once and conflicting input cannot reuse a request ID',async()=>{
 const f=workspaceFixture(),input={board_id:'tutor',spec};await f.once('alice','board-request-123','save_board_kit',input,()=>f.execute('save_board_kit',input,alice));
 const replay=await f.once('alice','board-request-123','save_board_kit',input,()=>f.execute('save_board_kit',input,alice));assert.equal(replay.replayed,true);assert.equal((await f.execute('board_kits',{},alice)).boards.length,1);
 await assert.rejects(f.once('alice','board-request-123','save_board_kit',{...input,spec:{...spec,title:'Other'}},()=>{}),/different action/);
});
test('MCP tool schemas expose the creator and typed kit tools while read-only grants cannot save',async()=>{
 const f=workspaceFixture(),server=new McpServer({name:'studio',version:'1'}),client=new Client({name:'studio-client',version:'1'});let allowWrite=false;
 registerWorkspaceBoard(server,{authorize:async(_name,write)=>{if(write && !allowWrite)throw Error('Read-only grant');},call:(action,input,request)=>request?f.once('alice',request,action,input,()=>f.execute(action,input,alice)):f.execute(action,input,alice)});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{const list=await client.listTools();assert.ok(list.tools.find(t=>t.name==='read_nexus_board_creator'));assert.equal(list.tools.find(t=>t.name==='save_nexus_board_kit').annotations.readOnlyHint,false);
 const creator=await client.callTool({name:'read_nexus_board_creator',arguments:{}});assert.equal(creator.structuredContent.creator.scope_first,true);
 const args={board_id:'tutor',spec,request_id:'mcp-board-123'};assert.equal((await client.callTool({name:'save_nexus_board_kit',arguments:args})).isError,true);assert.equal((await f.execute('board_kits',{},alice)).boards.length,0);
 allowWrite=true;assert.equal((await client.callTool({name:'save_nexus_board_kit',arguments:args})).structuredContent.status,'scoped');
 }finally{await client.close();await server.close();}
});
test('board UI starts creator scoping without writes and isolates previews from the host bridge',()=>{
 const html=readFileSync(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8');assert.match(html,/id="create-board"/);assert.match(html,/Use \$nexus-board-creator/);assert.match(html,/read_nexus_board_creator/);assert.match(html,/Show a scope covering visuals, tools, saved data, permissions/);
 assert.match(html,/frame\.setAttribute\('sandbox','allow-scripts'\)/);assert.match(html,/if\(event.source!==window.parent\)return/);assert.match(html,/default-src 'none'/);assert.doesNotMatch(html,/allow-same-origin/);
});

test('concurrent kit edits cannot silently overwrite and schema revisions cannot reinterpret saved records',async()=>{
 const f=workspaceFixture();let kit=await f.execute('save_board_kit',{board_id:'tutor',spec},alice);
 const input={board_id:'tutor',baseline:kit.baseline,spec};const results=await Promise.allSettled([f.execute('save_board_kit',input,alice),f.execute('save_board_kit',input,alice)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 await f.execute('save_board_entry',{board_id:'tutor',collection_id:'attempts',entry_id:'one',data:{answer:'x = 4'}},alice);kit=await f.execute('board_kit',{board_id:'tutor'},alice);
 await assert.rejects(f.execute('save_board_kit',{board_id:'tutor',baseline:kit.baseline,spec:{...spec,collections:[{...spec.collections[0],fields:[{id:'answer',label:'Answer',type:'number'}]}]}},alice),/Invalid value/);
 assert.equal((await f.execute('board_entries',{board_id:'tutor',collection_id:'attempts'},alice)).entries[0].data.answer,'x = 4');
});
test('private prototype caps are enforced without hiding existing kits or entries',async()=>{
 const f=workspaceFixture();for(let i=0;i<25;i++)await f.execute('save_board_kit',{board_id:'kit-'+i,spec},alice);
 await assert.rejects(f.execute('save_board_kit',{board_id:'overflow',spec},alice),/25-board/);assert.equal((await f.execute('board_kits',{},alice)).boards.length,25);
 for(let i=0;i<50;i++)await f.execute('save_board_entry',{board_id:'kit-0',collection_id:'attempts',entry_id:'entry-'+i,data:{answer:'answer'}},alice);
 await assert.rejects(f.execute('save_board_entry',{board_id:'kit-0',collection_id:'attempts',entry_id:'overflow',data:{answer:'answer'}},alice),/50-entry/);assert.equal((await f.execute('board_entries',{board_id:'kit-0',collection_id:'attempts'},alice)).entries.length,50);
});
