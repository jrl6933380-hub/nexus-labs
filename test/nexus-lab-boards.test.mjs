import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusLabBoards,cleanBoard,BOARD_LIMITS} from '../lib/nexusLabBoards.js';
const owner={id:'justin'},other={id:'someone-else'};
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

test('a board keeps any mix of visuals, notes, pictures and sketches and round-trips through save and read',async()=>{
  const boards=setup(),saved=await boards.save(owner,{board:draft()});
  assert.equal(saved.rev,1);assert.equal(saved.items.length,4);assert.equal(saved.look,'dots');assert.equal(saved.items[3].strokes[0].c,'#e8c36a');
  const read=await boards.read(owner,saved.id);assert.deepEqual(read,saved);
  const listed=await boards.list(owner);assert.equal(listed.boards.length,1);assert.equal(listed.boards[0].items,4);assert.equal(listed.limits.items,BOARD_LIMITS.items);
});
test('saving again needs the revision that was opened so a stale tab cannot overwrite a newer save',async()=>{
  const boards=setup(),first=await boards.save(owner,{board:draft()});
  const second=await boards.save(owner,{board:{...draft([note]),id:first.id},base_rev:1});assert.equal(second.rev,2);
  await assert.rejects(boards.save(owner,{board:{...draft(),id:first.id},base_rev:1}),{status:409});
  await assert.rejects(boards.save(owner,{board:{...draft(),id:first.id}}),{status:409});
  assert.equal((await boards.read(owner,first.id)).items.length,1);
});
test('another account never sees or removes a board',async()=>{
  const boards=setup(),saved=await boards.save(owner,{board:draft()});
  assert.deepEqual((await boards.list(other)).boards,[]);
  await assert.rejects(boards.read(other,saved.id),{status:404});await assert.rejects(boards.remove(other,saved.id),{status:404});
  assert.deepEqual(await boards.remove(owner,saved.id),{deleted:true,id:saved.id});await assert.rejects(boards.read(owner,saved.id),{status:404});
});
test('invalid boards are rejected before anything is stored',()=>{
  const bad=[
    {...draft(),name:'  '},{...draft(),look:'neon'},{...draft(),bg:'red'},{...draft(),view:{x:0,y:0,z:50}},
    draft([{...visual,html:'  '}]),draft([{...visual,html:'x'.repeat(BOARD_LIMITS.visualBytes+1)}]),
    draft([{...note,color:'purple'}]),draft([{...image,media_id:'../etc/passwd'}]),draft([{...image,kind:'script'}]),
    draft([visual,{...note,id:'v1'}]),draft([{...sketch,strokes:[{c:'red',s:4,p:[[0,0]]}]}]),draft([{...sketch,strokes:[{c:'#ffffff',s:4,p:[[0,0,0]]}]}]),
    draft(Array.from({length:BOARD_LIMITS.items+1},(_,i)=>({...note,id:`n${i}`}))),
    draft([{...visual,w:5}]),draft([{...visual,x:Infinity}]),draft([{...visual,title:'a\nb'}]),
  ];
  for(const board of bad)assert.throws(()=>cleanBoard(board,{id:'b1'}),e=>e.status>=400&&e.status<500);
  assert.throws(()=>cleanBoard(draft([{...sketch,id:'s1',strokes:Array.from({length:BOARD_LIMITS.strokes},(_,i)=>({c:'#000000',s:3,p:Array.from({length:BOARD_LIMITS.pointsPerStroke},(__,j)=>[j,i])}))}])),/too many sketch points/);
});
test('visual code is stored as inert text and never interpreted on the server',async()=>{
  const boards=setup(),code='<script>fetch("/api/x")</script><img src=x onerror=alert(1)>';
  const saved=await boards.save(owner,{board:draft([{...visual,html:code}])});assert.equal(saved.items[0].html,code);
});
test('a full account cannot keep more than the board limit',async()=>{
  const boards=setup();for(let i=0;i<BOARD_LIMITS.boards;i++)await boards.save(owner,{board:{...draft([note]),name:`b${i}`}});
  await assert.rejects(boards.save(owner,{board:draft([note])}),{status:409});
});
