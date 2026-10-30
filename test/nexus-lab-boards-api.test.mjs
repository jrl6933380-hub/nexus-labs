import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
const owner={id:'justin'};
function memory(){const hashes=new Map();return async(args)=>{const [op,key,field,value]=args;
 if(op==='EVAL'){const [,,,storage,id,old,next]=args;const m=hashes.get(storage)||new Map();if(m.get(id)!==old)return 0;m.set(id,next);hashes.set(storage,m);return 1;}
const h=hashes.get(key)||new Map();hashes.set(key,h);
  if(op==='HGET')return h.get(field)??null;if(op==='HSET'){h.set(field,value);return 1;}if(op==='HDEL')return h.delete(field)?1:0;
  if(op==='HGETALL')return [...h.entries()].flat();throw Error(`unexpected ${op}`);};}
let ticks=0;const setup=()=>createNexusLabBoards({command:memory(),now:()=>++ticks,uuid:()=>`board${String(ticks).padStart(8,'0')}aaaaaaaa`});
const visual={id:'v1',kind:'visual',x:10,y:20,w:300,h:200,z:1,title:'Chart',html:'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'};
const note={id:'n1',kind:'note',x:0,y:0,w:160,h:120,z:2,text:'idea',color:'sky'};
const image={id:'i1',kind:'image',x:50,y:50,w:200,h:200,z:3,media_id:'med-000001'};
const sketch={id:'s1',kind:'sketch',x:0,y:0,w:400,h:300,z:4,strokes:[{c:'#E8C36A',s:6,p:[[1,1],[20,30],[40,35]]}]};
const draft=(items=[visual,note,image,sketch])=>({name:'Ad ideas',look:'dots',bg:'#0e1412',view:{x:5,y:6,z:1.5},items});

test('owner API serves board actions with owner auth and the same-origin rule',async()=>{
  const boards=setup(),handler=createNexusLabHandler({authenticate:async()=>owner,boards});
  const res=()=>({setHeader(){return this;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}});
  const req=(action,input,headers={})=>({method:'POST',headers:{origin:'https://nexus.test',host:'nexus.test','content-type':'application/json',...headers},body:{action,input}});
  let r=res();await handler(req('board_save',{board:draft()}),r);assert.equal(r.code,200);const id=r.body.board.id;
  r=res();await handler(req('board_list',{}),r);assert.equal(r.body.boards.length,1);
  r=res();await handler(req('board_read',{id}),r);assert.equal(r.body.board.items.length,4);
  r=res();await handler(req('board_save',{board:{...draft(),name:''}}),r);assert.equal(r.code,400);
  r=res();await handler(req('board_nope',{}),r);assert.equal(r.code,400);
  r=res();await handler(req('board_list',{},{origin:'https://evil.test'}),r);assert.equal(r.code,403);
  r=res();await createNexusLabHandler({authenticate:async()=>null,boards})(req('board_list',{}),r);assert.equal(r.code,401);
  r=res();await handler(req('board_delete',{id}),r);assert.equal(r.body.deleted,true);
});
