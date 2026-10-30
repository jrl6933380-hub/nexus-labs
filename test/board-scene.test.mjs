import test from 'node:test';
import assert from 'node:assert/strict';
import {runScript} from '../lib/store/lua.js';
import {animatedSceneHtml} from '../public/board-scene-export.js';
import {webcrypto} from 'node:crypto';
import {cleanScene,emptyScene,newLayer,sceneCommand,worldLayers,point,hitLayer,mediaIds} from '../public/board-scene-core.js';
import {createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
import {labJobMemory} from '../test-support/labJobMemory.mjs';
globalThis.crypto??=webcrypto;
const group={id:'g',name:'Bird puppet',type:'group',x:100,y:200,w:100,h:100,rotation:0,motion:{kind:'travel',dx:200,dy:0}};
const image={id:'wing',name:'Wing',type:'image',parent_id:'g',media_id:'med-wing001',x:20,y:10,w:50,h:20,pivot:{x:0,y:.5},motion:{kind:'flap',amount:30,period:2}};
const scene=()=>cleanScene({...emptyScene(),layers:[group,image]});
function durableMemory(){
 const primitive=labJobMemory();let chain=Promise.resolve();
 return args=>{if(args[0]!=='EVAL')return primitive(args);const work=chain.then(()=>runScript(args[1],{keys:[args[3]],argv:args.slice(4),redisCall:primitive}));chain=work.catch(()=>{});return work;};
}
const owner={id:'scene-owner'},other={id:'other-owner'};
test('groups and individual pivots compose deterministic independent motion',()=>{
  const s=scene();const a=worldLayers(s,0).map.get('wing'),b=worldLayers(s,.5).map.get('wing');
  assert.deepEqual(point(a.matrix,0,10),{x:120,y:220});
  const pivot=point(b.matrix,0,10);assert.ok(Math.abs(pivot.x-(120+200*.5/6))<.001);assert.equal(pivot.y,220);
  assert.notDeepEqual(a.matrix,b.matrix);assert.deepEqual(mediaIds(s),['med-wing001']);
});
test('masks, zones and stable ids survive roundtrip; invalid graphs and bounds fail',()=>{
  const s=scene();s.layers.push({id:'zone',name:'Ground',type:'zone',shape:'rect',color:'#889977',x:0,y:300,w:1080,h:1000});
  s.layers[1].zone_id='zone';s.layers[1].mask={base:'hidden',strokes:[{op:'add',size:.05,points:[[.1,.2],[.8,.6]]}]};
  const saved=cleanScene(s);assert.deepEqual(cleanScene(JSON.parse(JSON.stringify(saved))),saved);
  const broken=[s=>s.layers[0].parent_id='g',s=>s.layers[0].parent_id='wing',s=>s.layers[1].zone_id='wing',s=>s.layers[1].x=Infinity,s=>s.layers[1].motion.kind='eval',s=>s.layers[1].mask.strokes[0].points=[[8,0]],s=>s.layers.push(s.layers[0])];
  for(const breakIt of broken){const copy=structuredClone(saved);breakIt(copy);assert.throws(()=>cleanScene(copy));}
});
test('commands honor locks, reject cycles, duplicate a puppet with internal references and remove dependents',()=>{
  let s=scene();s=sceneCommand(s,{op:'patch',id:'g',patch:{locked:true}});
  assert.throws(()=>sceneCommand(s,{op:'patch',id:'wing',patch:{x:90}}),/Unlock/);
  s=sceneCommand(s,{op:'patch',id:'g',patch:{locked:false}});
  s=sceneCommand(s,{op:'duplicate',id:'g'});assert.equal(s.layers.length,4);
  const copy=s.layers.find(l=>l.name==='Wing copy');assert.notEqual(copy.parent_id,'g');assert.ok(s.layers.some(l=>l.id===copy.parent_id));
  s=sceneCommand(s,{op:'remove',id:'g'});assert.equal(s.layers.length,2);
  assert.throws(()=>sceneCommand(s,{op:'settings',patch:{layers:[]}}),/Unsupported/);
});
test('hit selection respects parent transforms, locks, visibility and placement zones',()=>{
  let s=scene();assert.equal(hitLayer(s,0,125,215),'wing');
  s.layers[0].locked=true;assert.equal(hitLayer(s,0,125,215),null);s.layers[0].locked=false;
  s.layers.push({id:'zone',name:'Zone',type:'zone',shape:'rect',x:0,y:300,w:1080,h:100,color:'#112233'});
  s.layers[1].zone_id='zone';s=cleanScene(s);assert.equal(hitLayer(s,0,125,215),null);
});
test('owner scene save/edit/reopen preserves graph, CAS rejects concurrent and stale saves',async()=>{
  const boards=createNexusLabBoards({command:durableMemory()});
  const board=await boards.save(owner,{board:{name:'Puppets',items:[{id:'puppet',kind:'scene',scene:scene(),title:'Bird',x:0,y:0,w:320,h:400,z:0}],view:{x:0,y:0,z:1}}});
  const edited=await boards.editScene(owner,{id:board.id,item_id:'puppet',base_rev:1,commands:[{op:'patch',id:'wing',patch:{name:'Left wing'}}]});
  assert.equal(edited.items[0].scene.layers[1].name,'Left wing');
  await assert.rejects(boards.editScene(other,{id:board.id,item_id:'puppet',base_rev:2,commands:[{op:'remove',id:'g'}]}),{status:404});
  await assert.rejects(boards.editScene(owner,{id:board.id,item_id:'puppet',base_rev:1,commands:[{op:'remove',id:'g'}]}),{status:409});
  const results=await Promise.allSettled([boards.save(owner,{board:edited,base_rev:2}),boards.save(owner,{board:edited,base_rev:2})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  assert.equal((await boards.read(owner,board.id)).rev,3);
});
test('scene API edit uses authenticated owner and same-origin gate',async()=>{
  const boards=createNexusLabBoards({command:durableMemory()}),b=await boards.save(owner,{board:{name:'Scene',items:[{id:'s',kind:'scene',scene:scene(),x:0,y:0,w:320,h:400,z:0}]}});
  const handler=createNexusLabHandler({authenticate:async()=>owner,boards});
  const req={method:'POST',headers:{origin:'https://nexus.test',host:'nexus.test','content-type':'application/json'},body:{action:'board_scene_edit',input:{id:b.id,item_id:'s',base_rev:1,commands:[{op:'mask_stroke',id:'wing',stroke:{op:'subtract',size:.1,points:[[.2,.3]]}}]}}};
  const res=()=>({setHeader(){return this;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
  let r=res();await handler(req,r);assert.equal(r.code,200);assert.equal(r.body.board.items[0].scene.layers[1].mask.strokes.length,1);
  r=res();await handler({...req,headers:{...req.headers,origin:'https://other.test'}},r);assert.equal(r.code,403);
});

test('animated HTML escapes script-looking layer names and carries image credits',()=>{
 const s=scene();s.layers[1].name='</script><script>window.pwned=true</script>';
 const renderer={layerPng:()=> 'data:image/png;base64,AA==',images:new Map([['test',{asset:{provenance:{attribution:'Photo by test <creator>'}}}]])};
 const html=animatedSceneHtml(s,renderer);assert.equal(html.includes('</script><script>window.pwned'),false);assert.ok(html.includes('Photo by test'));
});
