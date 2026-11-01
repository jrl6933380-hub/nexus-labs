import test from 'node:test';
import assert from 'node:assert/strict';
import {putFlowVideo,flowDropIndex,flowHeight,FLOW_LIMIT} from '../public/board-post-flow-core.js';
import {cleanItem,createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {labJobMemory} from '../test-support/labJobMemory.mjs';
const tool={id:'flow',kind:'tool',tool_id:'social-post-flow',x:10,y:20,w:716,h:292,z:1,title:'Queue'};
test('empty flow grows one row at a time, replacement preserves copy, capacity is enforced',()=>{
 let rows=putFlowVideo([],'med-video01','First');assert.equal(rows.length,1);rows[0].caption='Original caption';
 const replacement=putFlowVideo(rows,'med-video02','Second',0);assert.equal(replacement.length,1);assert.equal(replacement[0].caption,'Original caption');assert.equal(rows[0].media_id,'med-video01');
 while(rows.length<FLOW_LIMIT)rows=putFlowVideo(rows,'med-video01','Next');
 assert.throws(()=>putFlowVideo(rows,'med-video01'),/20 videos/);assert.equal(flowHeight(rows),48+20*280);
 assert.throws(()=>putFlowVideo([],'https://bad.example/video'),/saved video/);
});
test('drop hit testing uses world coordinates and only video slots including compact next target',()=>{
 assert.equal(flowDropIndex(tool,{x:30,y:80}),0);assert.equal(flowDropIndex(tool,{x:400,y:80}),-1);
 const filled={...tool,flow_rows:putFlowVideo([],'med-video01')};assert.equal(flowDropIndex(filled,{x:30,y:20+48+280+20}),1);
 assert.equal(flowDropIndex(filled,{x:30,y:20+48+280+60}),-1);
});
test('flow copy persists with board revision protection and account isolation',async()=>{
 const boards=createNexusLabBoards({command:labJobMemory()}),owner={id:'one'};
 const rows=putFlowVideo([],'med-video01','First');rows[0].caption='Safe <script> text';
 const saved=await boards.save(owner,{board:{name:'Queue',items:[{...tool,flow_rows:rows}]}});
 assert.deepEqual((await boards.read(owner,saved.id)).items[0].flow_rows,rows);
 await assert.rejects(boards.read({id:'other'},saved.id),{status:404});
 await assert.rejects(boards.save(owner,{board:saved,base_rev:0}),{status:409});
});
test('server bounds rows and strips arbitrary execution properties',()=>{
 const rows=putFlowVideo([],'med-video01');rows[0].html='<script>bad()</script>';
 assert.equal(cleanItem({...tool,flow_rows:rows}).flow_rows[0].html,undefined);
 assert.throws(()=>cleanItem({...tool,flow_rows:Array(21).fill(rows[0])}),/20 videos/);
 assert.throws(()=>cleanItem({...tool,flow_rows:[{...rows[0],platform:'evil'}]}),/platform/);
 assert.throws(()=>cleanItem({...tool,flow_rows:[{...rows[0],caption:'x'.repeat(1601)}]}),/Caption/);
});
