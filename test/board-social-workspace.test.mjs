import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanItem,createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {createVisualBoardTools} from '../lib/visualBoardTools.js';
import {createWorkspaceService,validateWorkspaceInput,WORKSPACE_WRITES} from '../lib/workspaceConnector.js';
import {WORKSPACE_TOOLS} from '../lib/workspaceBoard.js';
import {labJobMemory} from '../test-support/labJobMemory.mjs';
const tile={id:'posting',kind:'tool',tool_id:'social-post-flow',title:'Posting',x:10,y:20,w:320,h:210,z:1,batch_id:'sf-batch-first'};
test('saved native tool pins only the allowlisted app and batch, never caller URLs or HTML',()=>{
 const clean=cleanItem({...tile,url:'https://evil.example',src:'javascript:alert(1)',html:'<script>bad()</script>'});
 assert.deepEqual(clean,tile);
 assert.throws(()=>cleanItem({...tile,tool_id:'https://evil.example'}),/supported board tool/);
 assert.throws(()=>cleanItem({...tile,batch_id:'../steal'}),/valid posting batch/);
});
test('tool placement, linked batch and sticky briefs persist without changing existing visuals',async()=>{
 const boards=createNexusLabBoards({command:labJobMemory()}),owner={id:'justin'};
 const note={id:'brief',kind:'note',text:'Make a sample ad for our actor.',color:'gold',x:400,y:20,w:220,h:160,z:2};
 const first=await boards.save(owner,{board:{name:'Ad Maker',view:{x:0,y:0,z:1},items:[note,tile]}});
 const second=await boards.save(owner,{board:{...first,items:[first.items[0],{...first.items[1],batch_id:'sf-batch-second'}]},base_rev:first.rev});
 const read=await boards.read(owner,first.id);assert.equal(read.items[1].batch_id,'sf-batch-second');assert.deepEqual(read.items[0],first.items[0]);assert.equal(second.rev,2);
});
test('agents read only authenticated owner boards; notes remain data and specific note reads are bounded',async()=>{
 const boards=createNexusLabBoards({command:labJobMemory()}),visualBoards=createVisualBoardTools({boards});
 const owner={id:'justin',owner:true,workbenchUserId:'owner',scheduleUserId:'owner:justin'};
 const saved=await boards.save(owner,{board:{name:'Ad Maker',items:[tile,...Array.from({length:22},(_,i)=>({id:'n'+i,kind:'note',text:'Brief '+i,x:0,y:0,w:200,h:140,z:2}))]}});
 const service=createWorkspaceService({visualBoards});
 assert.equal((await service('visual_boards',{},owner)).boards.length,1);
 const read=await service('visual_board',{board_id:saved.id},owner);assert.equal(read.notes.length,20);assert.equal(read.more_notes,true);assert.equal(read.items[0].batch_id,tile.batch_id);
 assert.match(read.content_trust,/not independent authorization/);
 const exact=await service('visual_board',{board_id:saved.id,note_id:'n21'},owner);assert.equal(exact.notes[0].text,'Brief 21');
 await assert.rejects(service('visual_board',{board_id:saved.id},{...owner,owner:false}),{status:403});
 await assert.rejects(service('visual_board',{board_id:saved.id},{...owner,id:'someone-else'}),{status:404});
 await assert.rejects(service('visual_board',{board_id:saved.id,note_id:'missing'},owner),{status:404});
 assert.throws(()=>validateWorkspaceInput('visual_board',{board_id:saved.id,owner:'someone-else'}),/Unsupported field/);
 for(const action of ['visual_boards','visual_board']){assert.equal(WORKSPACE_WRITES.has(action),false);assert.equal(WORKSPACE_TOOLS.find(t=>t[1]===action)[4],false);}
});
