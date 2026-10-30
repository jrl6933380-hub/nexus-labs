// Shared, deterministic scene contract. No DOM, provider calls or executable code.
export const SCENE_LIMITS=Object.freeze({layers:24,strokes:80,points:2400,pointsPerStroke:160,bytes:65000});
export const TAG_COLORS=['#8ed9b6','#efb859','#75b9fa','#ef93c7','#bd9afa','#f18b70'];
export const MOTIONS=['none','sway','bob','travel','pulse','flap','talk'];
const fail=m=>{throw Object.assign(Error(m),{status:400});};
const obj=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(label+' must be an object.');return v;};
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(v);
const num=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(label+' is out of range.');return Math.round(v*10000)/10000;};
const str=(v,n,label)=>{if(typeof v!=='string'||v.length>n||/[\x00-\x1f\x7f]/.test(v))fail(label+' must be plain text.');return v;};
const color=v=>{if(typeof v!=='string'||!/^#[\da-f]{6}$/i.test(v))fail('Use a six-digit color.');return v.toLowerCase();};
export function cleanScene(raw){
  obj(raw,'Scene');if(!Number.isInteger(raw.width)||!Number.isInteger(raw.height))fail('Scene dimensions must be whole pixels.');if(raw.version!==1)fail('Unsupported scene version.');
  const scene={version:1,width:num(raw.width,40,2048,'Scene width'),height:num(raw.height,40,2048,'Scene height'),duration:num(raw.duration,1,30,'Duration'),background:raw.background==='transparent'?'transparent':color(raw.background),layers:[]};
  if(scene.width*scene.height>4000000)fail('Use a scene under four megapixels.');
  if(!Array.isArray(raw.layers)||raw.layers.length>SCENE_LIMITS.layers)fail('A scene holds up to 24 layers.');
  let points=0;
  scene.layers=raw.layers.map((r,index)=>{
    obj(r,'Layer');if(!id(r.id))fail('Each layer needs a stable id.');
    if(!['image','shape','text','group','zone'].includes(r.type))fail('Unsupported scene layer.');
    const l={id:r.id,name:str(r.name,80,'Layer name'),type:r.type,parent_id:r.parent_id||'',tag:color(r.tag||TAG_COLORS[index%TAG_COLORS.length]),x:num(r.x,-8192,8192,'Layer x'),y:num(r.y,-8192,8192,'Layer y'),w:num(r.w,1,4096,'Layer width'),h:num(r.h,1,4096,'Layer height'),rotation:num(r.rotation??0,-3600,3600,'Rotation'),opacity:num(r.opacity??1,0,1,'Opacity'),pivot:{x:num(r.pivot?.x??.5,0,1,'Pivot x'),y:num(r.pivot?.y??.5,0,1,'Pivot y')},visible:r.visible!==false,locked:r.locked===true,zone_id:r.zone_id||''};
    if(!l.name.trim())fail('Give each layer a name.');
    if(['group','zone'].includes(l.type)&&l.zone_id)fail('Apply placement zones to individual image, shape or text pieces.');
    if(l.type==='image'){if(typeof r.media_id!=='string'||!/^med-[a-zA-Z0-9_-]{6,100}$/.test(r.media_id))fail('Choose a saved image.');l.media_id=r.media_id;}
    if(['shape','zone'].includes(l.type)){if(!['rect','ellipse'].includes(r.shape))fail('Choose a rectangle or ellipse.');l.shape=r.shape;l.color=color(r.color||l.tag);}
    if(l.type==='text'){l.text=str(r.text||'',240,'Layer text');l.color=color(r.color||'#ffffff');l.font_size=num(r.font_size??48,8,300,'Font size');}
    const m=r.motion||{kind:'none'};obj(m,'Motion');if(!MOTIONS.includes(m.kind))fail('Unsupported motion.');
    l.motion={kind:m.kind,amount:num(m.amount??10,0,200,'Motion strength'),period:num(m.period??3,.2,30,'Motion period'),phase:num(m.phase??0,0,1,'Motion phase'),dx:num(m.dx??100,-4096,4096,'Path x'),dy:num(m.dy??0,-4096,4096,'Path y')};
    if(r.mask){
      if(['group','zone'].includes(l.type))fail('Paint masks on image, shape or text pieces; zones use their shape.');
      obj(r.mask,'Mask');if(!['visible','hidden'].includes(r.mask.base)||!Array.isArray(r.mask.strokes)||r.mask.strokes.length>SCENE_LIMITS.strokes)fail('Invalid layer mask.');
      l.mask={base:r.mask.base,strokes:r.mask.strokes.map(s=>{
        obj(s,'Mask stroke');if(!['add','subtract'].includes(s.op)||!Array.isArray(s.points)||!s.points.length||s.points.length>SCENE_LIMITS.pointsPerStroke)fail('Invalid mask stroke.');
        points+=s.points.length;
        return {op:s.op,size:num(s.size,.002,1,'Mask brush size'),points:s.points.map(p=>{if(!Array.isArray(p)||p.length!==2)fail('Invalid mask point.');return [num(p[0],0,1,'Mask x'),num(p[1],0,1,'Mask y')];})};
      })};
    }
    if(r.shadow){if(['group','zone'].includes(l.type))fail('Apply shadows to individual pieces.');obj(r.shadow,'Shadow');l.shadow={color:color(r.shadow.color||'#000000'),blur:num(r.shadow.blur??16,0,100,'Shadow blur'),dx:num(r.shadow.dx??8,-100,100,'Shadow x'),dy:num(r.shadow.dy??12,-100,100,'Shadow y')};}
    l.blend=r.blend||'source-over';if(!['source-over','multiply','screen'].includes(l.blend))fail('Unsupported blend mode.');if(['group','zone'].includes(l.type)&&l.blend!=='source-over')fail('Apply blend modes to individual pieces.');
    return l;
  });
  if(points>SCENE_LIMITS.points)fail('This scene has too many mask points.');
  const map=new Map(scene.layers.map(l=>[l.id,l]));if(map.size!==scene.layers.length)fail('Layer ids must be unique.');
  for(const l of scene.layers){
    if(l.parent_id&&(!id(l.parent_id)||map.get(l.parent_id)?.type!=='group'))fail('Choose a group as parent.');
    const seen=new Set([l.id]);let parent=l.parent_id;
    while(parent){if(seen.has(parent))fail('Groups cannot contain themselves.');seen.add(parent);parent=map.get(parent)?.parent_id;}
    if(l.zone_id&&(map.get(l.zone_id)?.type!=='zone'||l.zone_id===l.id))fail('Choose another placement zone.');
  }
  if(new TextEncoder().encode(JSON.stringify(scene)).length>SCENE_LIMITS.bytes)fail('This scene is too large to save.');
  return scene;
}
export function newLayer(type,scene,extra={}){
  const l={id:'layer-'+globalThis.crypto.randomUUID().slice(0,12),name:type==='group'?'New group':type==='zone'?'Placement zone':'New '+type,type,parent_id:'',tag:TAG_COLORS[scene.layers.length%TAG_COLORS.length],x:scene.width*.25,y:scene.height*.25,w:scene.width*.5,h:scene.height*.5,rotation:0,opacity:1,pivot:{x:.5,y:.5},visible:true,locked:false,motion:{kind:'none'},zone_id:'',...extra};
  if(type==='group')Object.assign(l,{x:0,y:0,w:scene.width,h:scene.height},extra);
  if(type==='shape'||type==='zone')Object.assign(l,{shape:'rect',color:l.tag},extra);
  if(type==='text')Object.assign(l,{text:'Your message',color:'#ffffff',font_size:48,h:100},extra);
  return l;
}
export const emptyScene=()=>({version:1,width:1080,height:1350,duration:6,background:'#10251e',layers:[]});
export const descendants=(scene,id)=>{const set=new Set([id]);let size;do{size=set.size;for(const l of scene.layers)if(set.has(l.parent_id))set.add(l.id);}while(set.size!==size);return set;};
export function sceneCommand(raw,command){
  const scene=cleanScene(raw);obj(command,'Scene command');const l=scene.layers.find(x=>x.id===command.id),effectiveLocked=l&&worldLayers(scene,0).map.get(l.id)?.locked;
  if(command.op==='add')scene.layers.push(command.layer);
  else if(command.op==='settings'){obj(command.patch,'Scene settings');if(Object.keys(command.patch).some(k=>!['width','height','duration','background'].includes(k)))fail('Unsupported scene setting.');Object.assign(scene,command.patch);}
  else if(command.op==='patch'){if(!l)fail('Layer was not found.');obj(command.patch,'Layer settings');if(effectiveLocked&&Object.keys(command.patch||{}).some(k=>!['locked','visible'].includes(k)))fail('Unlock this layer first.');Object.assign(l,command.patch,{id:l.id});}
  else if(command.op==='remove'){if(!l)fail('Layer was not found.');if(effectiveLocked)fail('Unlock this layer or its parent first.');const ids=descendants(scene,l.id);scene.layers=scene.layers.filter(x=>!ids.has(x.id));for(const x of scene.layers)if(ids.has(x.zone_id))x.zone_id='';}
  else if(command.op==='reorder'){
    if(!l||effectiveLocked)fail('Select an unlocked layer.');const siblings=scene.layers.filter(x=>x.parent_id===l.parent_id),at=siblings.indexOf(l),other=siblings[at+(command.direction==='up'?1:-1)];
    if(other){const a=scene.layers.indexOf(l),b=scene.layers.indexOf(other);[scene.layers[a],scene.layers[b]]=[scene.layers[b],scene.layers[a]];}
  }else if(command.op==='mask_stroke'){
    if(!l||effectiveLocked||['group','zone'].includes(l.type))fail('Select an unlocked image, shape or zone.');
    l.mask=l.mask||{base:'visible',strokes:[]};l.mask.strokes.push(command.stroke);
  }else if(command.op==='duplicate'){
    if(!l)fail('Layer was not found.');const members=scene.layers.filter(x=>descendants(scene,l.id).has(x.id)),ids=new Map(members.map(x=>[x.id,'layer-'+globalThis.crypto.randomUUID().slice(0,12)]));
    for(const member of members){const copy=structuredClone(member);copy.id=ids.get(member.id);copy.parent_id=ids.get(member.parent_id)||member.parent_id;copy.zone_id=ids.get(member.zone_id)||member.zone_id;copy.name=(copy.name+' copy').slice(0,80);if(member.id===l.id){copy.x+=24;copy.y+=24;}scene.layers.push(copy);}
  }else fail('Unsupported scene command.');
  return cleanScene(scene);
}
export const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export const point=(m,x,y)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
export function inverse(m){const d=m[0]*m[3]-m[1]*m[2];return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
export function pose(layer,time,duration){
  let x=layer.x,y=layer.y,r=layer.rotation,sx=1,sy=1;const m=layer.motion||{kind:'none'},wave=Math.sin(2*Math.PI*(time/(m.period||3)+(m.phase||0))),amount=m.amount??10;
  if(m.kind==='bob')y+=amount*wave;
  if(m.kind==='sway'||m.kind==='flap')r+=amount*wave;
  if(m.kind==='travel'){x+=(m.dx||0)*time/duration;y+=(m.dy||0)*time/duration;}
  if(m.kind==='pulse')sx=sy=1+Math.min(.9,amount/100)*wave;
  if(m.kind==='talk')sy=.15+.85*Math.abs(wave);
  const rad=r*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),px=layer.pivot.x*layer.w,py=layer.pivot.y*layer.h;
  return multiply([1,0,0,1,x+px,y+py],multiply([c*sx,s*sx,-s*sy,c*sy,0,0],[1,0,0,1,-px,-py]));
}
export function worldLayers(scene,time=0){
  const entries=[],map=new Map();
  function visit(parent,matrix,opacity,visible,locked){
    for(const layer of scene.layers.filter(l=>l.parent_id===parent)){
      const entry={layer,matrix:multiply(matrix,pose(layer,time,scene.duration)),opacity:opacity*layer.opacity,visible:visible&&layer.visible,locked:locked||layer.locked};
      map.set(layer.id,entry);entries.push(entry);if(layer.type==='group')visit(layer.id,entry.matrix,entry.opacity,entry.visible,entry.locked);
    }
  }visit('',[1,0,0,1,0,0],1,true,false);
  return {entries,map};
}
export function hitLayer(scene,time,x,y){
  const {entries,map}=worldLayers(scene,time);
  for(const e of entries.reverse()){
    const l=e.layer;if(!e.visible||e.locked||['group','zone'].includes(l.type))continue;
    const p=point(inverse(e.matrix),x,y);if(p.x<0||p.y<0||p.x>l.w||p.y>l.h)continue;
    if(l.zone_id){const z=map.get(l.zone_id);if(z){const q=point(inverse(z.matrix),x,y),zone=z.layer;if(q.x<0||q.y<0||q.x>zone.w||q.y>zone.h)continue;if(zone.shape==='ellipse'&&((q.x/zone.w-.5)**2+(q.y/zone.h-.5)**2)>.25)continue;}}
    return l.id;
  }return null;
}
export function mediaIds(scene){return [...new Set(scene.layers.filter(l=>l.type==='image').map(l=>l.media_id))];}
