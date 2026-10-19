import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectV2,REGISTRY} from '../public/ad-vocabulary.mjs';
import {worldGeometry,worldSample,worldTransforms,worldMultiply} from '../public/ad-world3d.mjs';
import {composeAdFromBrief,adBriefSchema} from '../lib/adComposer.js';
import {composeWorld3DBrief,WORLD3D_SUBJECTS} from '../lib/adWorld3D.js';
import {describeAdVocabulary,adProjectSchemaV2} from '../lib/adVocabularyTools.js';
import {WORKSPACE_TOOLS} from '../lib/workspaceBoard.js';
import {validateWorkspaceInput,createWorkspaceService} from '../lib/workspaceConnector.js';
import {readFileSync} from 'node:fs';
import {imageIdsOf} from '../lib/adImages.js';
import {seedPlayerHtml} from '../lib/adExport.js';

const input={business_name:'Studio Concept',industry:'other',goal:'visit',visual:'studio3d',length_sec:6};
const project=()=>composeAdFromBrief(input).project;
const withObjects=objects=>{const p=project();p.scenes[0].params.objects=objects;return p;};
test('world3d presets validate through both registry and MCP schemas at every length',()=>{
  for(const subject of WORLD3D_SUBJECTS)for(const length_sec of [6,15,30]){
    const r=composeAdFromBrief({...input,subject,length_sec,material:'chrome',lighting:'warm',camera_move:'orbit'});
    assert.equal(validateProjectV2(r.project).ok,true);assert.equal(adProjectSchemaV2.safeParse(r.project).success,true);
    assert.equal(r.project.scenes.reduce((n,s)=>n+s.duration,0),length_sec);assert.equal(r.project.concept,true);
    assert.ok(r.notes.some(s=>/not a supplied product model/.test(s)));
  }
  assert.equal(REGISTRY.sceneTypes.find(s=>s.id==='world3d').check,'world3d');
  assert.ok(describeAdVocabulary().world3d_example);
});
test('3D options cannot be silently ignored by the standard brief path',()=>{
  assert.throws(()=>composeAdFromBrief({...input,visual:'standard',material:'metal'}),/need visual/);
  assert.equal(adBriefSchema.safeParse({...input,subject:'actual-car-model'}).success,false);
  assert.equal(adBriefSchema.safeParse({...input,subject_color:'javascript:bad'}).success,false);
  assert.throws(()=>composeWorld3DBrief({...input,subject:'unknown'}),/Unknown 3D subject/);
});
test('object IDs, parent order, values, budgets and animation ordering are validated',()=>{
  const obj={id:'one',shape:'sphere',y:.5,color:'#ff4400'};
  assert.equal(validateProjectV2(withObjects([obj])).ok,true);
  for(const objects of [[obj,{...obj}], [{...obj,parent:'later'}], [{...obj,shape:'script'}],
    [{...obj,color:'https://bad'}],[{...obj,roughness:-1}],[{...obj,x:Infinity}],
    [{...obj,arc:180}],
    [{...obj,keys:[{t:1,x:1},{t:0,x:0}]}], [{...obj,keys:[{t:0,x:1},{t:0,x:0}]}],
    Array.from({length:65},(_,i)=>({...obj,id:'o'+i}))]) assert.equal(validateProjectV2(withObjects(objects)).ok,false);
  const p=project();p.scenes[0].params.cameraPath=[{t:0,x:0,y:.7,z:0}];assert.equal(validateProjectV2(p).ok,false);
  p.scenes[0].params.cameraPath=[{t:0,x:0,y:.7,z:4}];p.scenes[0].params.lights=[{type:'directional',x:0,y:0,z:0}];assert.equal(validateProjectV2(p).ok,false);
  p.scenes[0].params.lights=[{type:'directional',x:0,y:4,z:2}];p.scenes[0].params.cameraPath=[{t:0,x:1,y:.7,z:0},{t:2,x:-1,y:.7,z:0}];assert.equal(validateProjectV2(p).ok,false);
});
test('sampled transforms are pure, interpolate properties and hold endpoints',()=>{
  const keys=[{t:0,x:0},{t:2,x:4,ease:'linear'}];
  assert.equal(worldSample(keys,'x',9,1),2);assert.equal(worldSample(keys,'x',9,3),4);assert.equal(worldSample(keys,'y',9,1),9);
  const objects=[{id:'root',shape:'group',x:2,ry:90,w:10,keys:[{t:0,x:2},{t:2,x:4}]},
    {id:'child',parent:'root',shape:'box',x:1,w:3,h:2,d:1}];
  const before=JSON.stringify(objects),r=worldTransforms(objects,1);
  assert.ok(Math.abs(r[1].world[12]-3)<1e-9);assert.ok(Math.abs(r[1].world[14]+1)<1e-9);
  assert.equal(JSON.stringify(objects),before);assert.deepEqual(worldTransforms(objects,1),r);
  // Object dimensions scale geometry only, not the child coordinate system.
  assert.ok(Math.abs(Math.hypot(r[1].mesh[0],r[1].mesh[1],r[1].mesh[2])-3)<1e-9);
  assert.deepEqual(worldMultiply([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],r[1].world),r[1].world);
});
test('mesh primitives have finite geometry, valid indices and outward unit normals',()=>{
  for(const shape of ['box','sphere','plane','cylinder','cone','torus']){
    const g=worldGeometry(shape);assert.ok(g.positions.length>0);assert.equal(g.positions.length,g.normals.length);
    assert.ok(g.positions.every(Number.isFinite));assert.ok(g.normals.every(Number.isFinite));
    assert.ok(g.indices.every(i=>Number.isInteger(i)&&i>=0&&i<g.positions.length/3));
    assert.ok(g.positions.every(v=>Math.abs(v)<=.50001));
    for(let i=0;i<g.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...g.normals.slice(i,i+3))-1)<1e-6);
  }
  const half=worldGeometry('torus',.12,180);assert.ok(half.positions.every((v,i)=>i%3!==2||v>=-1e-7),'half ring stays in positive Z before rotation');
});
test('MCP brief schema and connector allow the same 3D options; dry-run does not save',async()=>{
  const tool=WORKSPACE_TOOLS.find(t=>t[0]==='create_nexus_ad_from_brief');
  for(const field of ['visual','subject','material','lighting','camera_move','subject_color'])assert.ok(tool[3][field]);
  assert.doesNotThrow(()=>validateWorkspaceInput('create_ad_from_brief',input));
  let saves=0;const service=createWorkspaceService({ads:{save:async(user,p)=>{saves++;return{campaign_id:p.campaign_id,project:p.project,saved:true};}}});
  const user={id:'test',workbenchUserId:'test',scheduleUserId:'test'};
  const dry=await service('create_ad_from_brief',{...input,dry_run:true},user);
  assert.equal(dry.dry_run,true);assert.equal(saves,0);assert.equal(dry.project.scenes[0].type,'world3d');
  const saved=await service('create_ad_from_brief',{...input,campaign_id:'3d-test'},user);assert.equal(saved.saved,true);assert.equal(saves,1);
});
test('documented prompt/brief pairs are executable language examples',()=>{
  const examples=JSON.parse(readFileSync(new URL('../docs/ad-world3d-examples.json',import.meta.url),'utf8'));
  for(const {prompt,brief} of examples){assert.ok(prompt.length>10);const {project}=composeAdFromBrief(brief);assert.equal(project.scenes[0].type,'world3d');assert.ok(project.scenes[0].params.objects.some(o=>o.material===brief.material));}
});
test('shaped geometry fields pass the tool envelope and receive semantic registry validation',()=>{
  const profile=[{r:.3,y:-.5},{r:.5,y:0},{r:.2,y:.5}];
  for(const o of [{id:'body',shape:'lathe',profile},{id:'case',shape:'rounded_box',w:.8,h:1.6,d:.18,radius:.06}]) {
    const p=withObjects([o]);assert.equal(validateProjectV2(p).ok,true);assert.equal(adProjectSchemaV2.safeParse(p).success,true);
  }
  for(const o of [{shape:'lathe'},{shape:'lathe',profile:[]},{shape:'lathe',profile:[{r:0,y:0},{r:0,y:.5}]},
    {shape:'lathe',profile:[{r:.5,y:0},{r:.2,y:0}]},{shape:'lathe',profile:[{r:.5,y:.5},{r:.2,y:0}]},
    {shape:'lathe',profile:[{r:.6,y:-.5},{r:.2,y:.5}]},{shape:'lathe',profile:Array.from({length:33},(_,i)=>({r:.3,y:i/32-.5}))},
    {shape:'box',profile},{shape:'sphere',radius:.1},{shape:'box',capped:false},{shape:'box',profileCurve:'smooth'},
    {shape:'rounded_box',d:.1,radius:.06}]) {
    // MCP params intentionally remain a record; semantic validation is the
    // shared registry check used by save, edit and render entry points.
    const p=withObjects([{id:'bad',...o}]);assert.equal(validateProjectV2(p).ok,false,JSON.stringify(o));
  }
});
test('rounded boxes preserve physical radius and smoothly varying corner normals',()=>{
  const dims=[.8,1.6,.18],r=.06,g=worldGeometry('rounded_box',.2,360,{w:dims[0],h:dims[1],d:dims[2],radius:r});
  for(let i=0;i<g.positions.length;i+=3){
    const P=g.positions.slice(i,i+3).map((v,j)=>v*dims[j]);
    const C=P.map((v,j)=>Math.max(-dims[j]/2+r,Math.min(dims[j]/2-r,v)));
    assert.ok(Math.abs(Math.hypot(...P.map((v,j)=>v-C[j]))-r)<1e-8);
    const N=g.normals.slice(i,i+3).map((v,j)=>v/dims[j]),len=Math.hypot(...N);
    P.forEach((v,j)=>assert.ok(Math.abs(N[j]/len-(v-C[j])/r)<1e-8));
  }
  assert.deepEqual(worldGeometry('rounded_box',.2,360,{radius:0}),worldGeometry('box'));
});
test('lathe interpolation stays bounded, caps are optional and maximum meshes fit WebGL1 indices',()=>{
  const profile=Array.from({length:32},(_,i)=>({r:i%2?.5:.01,y:i/31- .5}));
  for(const profileCurve of ['linear','smooth'])for(const capped of [true,false]){
    const g=worldGeometry('lathe',.2,360,{profile,profileCurve,capped});
    assert.ok(g.positions.every(Number.isFinite));assert.ok(g.normals.every(Number.isFinite));assert.ok(g.positions.length/3<65536);
    assert.ok(g.indices.every(i=>Number.isInteger(i)&&i>=0&&i<g.positions.length/3));
    for(let i=0;i<g.positions.length;i+=3){assert.ok(Math.hypot(g.positions[i],g.positions[i+2])<=.500001);assert.ok(Math.abs(g.positions[i+1])<=.500001);assert.ok(Math.abs(Math.hypot(...g.normals.slice(i,i+3))-1)<1e-6);}
  }
  const p=[{r:.3,y:-.5},{r:.5,y:.5}],open=worldGeometry('lathe',.2,360,{profile:p,capped:false}),closed=worldGeometry('lathe',.2,360,{profile:p});
  assert.equal(closed.indices.length-open.indices.length,240);
});
test('surface maps validate as owned image IDs with an eight-image scene budget',()=>{
  const obj={id:'body',shape:'sphere',colorMap:'img-0123456789',roughnessMap:'img-abcdef0123',mapProjection:'spherical',mapScale:2};
  const p=withObjects([obj]);assert.equal(validateProjectV2(p).ok,true);
  assert.deepEqual(imageIdsOf(p),['img-0123456789','img-abcdef0123']);
  assert.throws(()=>seedPlayerHtml('<div id="stage"></div>',p,{}),/Missing library images/);
  for(const o of [{...obj,colorMap:'https://example.invalid/image.png'},{...obj,roughnessMap:'data:image/png;base64,AAAA'},
    {...obj,shape:'group'},{...obj,mapProjection:'unknown'},{...obj,mapScale:0},{...obj,mapOffsetX:Infinity},
    {id:'body',shape:'box',mapScale:1}])assert.equal(validateProjectV2(withObjects([o])).ok,false);
  const objects=Array.from({length:9},(_,i)=>({...obj,id:'o'+i,colorMap:'img-'+String(i).padStart(10,'0'),roughnessMap:undefined}));
  assert.equal(validateProjectV2(withObjects(objects)).ok,false);assert.equal(validateProjectV2(withObjects(objects.slice(0,8))).ok,true);
});
test('connector resolves surface maps in the connected account before saving',async()=>{
  const p=withObjects([{id:'body',shape:'sphere',colorMap:'img-0123456789'}]);let saves=0,owner;
  const service=createWorkspaceService({images:{resolve:async(user,ids)=>{owner=user;return{images:{},missing:ids};}},ads:{saveV2:async()=>{saves++;}}});
  await assert.rejects(service('save_ad_v2',{campaign_id:'texture-test',project:p},{id:'texture-owner',workbenchUserId:'texture-owner',scheduleUserId:'texture-owner'}),/Image not found in your library: img-0123456789/);
  assert.equal(owner,'texture-owner');assert.equal(saves,0);
});
