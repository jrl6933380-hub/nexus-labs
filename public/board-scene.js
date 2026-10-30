import {cleanScene,sceneCommand,newLayer,emptyScene,MOTIONS,worldLayers,pose,inverse,point,hitLayer,mediaIds} from './board-scene-core.js?v=20261030-scene1';
import {createSceneRenderer} from './board-scene-render.js?v=20261030-scene1';
import {animatedSceneHtml} from './board-scene-export.js?v=20261030-scene1';
import {savePngAsset} from './board-compose.js?v=20261030-sources1';
import {el,btn,openSceneSources} from './board-scene-sources.js?v=20261030-scene1';

export async function runSceneEditor({request,item,boardItems=[],onUpload,onSave,onExport}){
  let scene=cleanScene(item?.scene||emptyScene()),selected=scene.layers.at(-1)?.id||'',dirty=!item?.id,disposed=false,saving=false,loading=false,time=0,playing=false,last=0,raf,gesture=null,masking=false,pivoting=false,sourcePane=null,loadGeneration=0,loadedKey=null,assetError=null,loadChain=Promise.resolve();
  const undo=[],redo=[],renderer=createSceneRenderer(request),urls=new Set(),previousFocus=document.activeElement;
  const host=el('section');host.className='scene-editor composer';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','Compose scene');
  const header=el('header');header.className='compose-top';header.append(el('h2','Compose scene'),btn('Preview',()=>preview.scrollIntoView({block:'center'})),btn('Close scene',close));
  const body=el('div');body.className='scene-body';
  const status=el('p','Loading scene…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const saveState=el('span',dirty?'Unsaved scene':'Saved scene');saveState.className='scene-save-state';
  const save=btn('Save editable scene',async()=>{
    if(saving)return;saving=true;updateDisabled();status.textContent='Saving editable layers…';
    try{const result=await onSave(structuredClone(scene));if(disposed)return;if(result?.id)item=result;dirty=false;saveState.textContent='Saved scene';status.textContent='Editable scene saved. Layers, masks and motions are preserved.';}
    catch(e){status.textContent=e.message||'Could not save scene.';}finally{saving=false;updateDisabled();}
  });
  const discard=btn('Discard scene changes',dispose);discard.hidden=true;
  const actions=el('div');actions.className='scene-toolbar';actions.append(save,saveState,discard);
  const preview=el('div');preview.className='scene-preview';const canvas=el('canvas');canvas.setAttribute('aria-label','Scene preview');preview.append(canvas);
  const transport=el('div');transport.className='scene-transport';
  const play=btn('Play',()=>{playing=!playing;last=performance.now();play.textContent=playing?'Pause':'Play';});
  const scrub=el('input');scrub.type='range';scrub.min=0;scrub.max=scene.duration;scrub.step=.02;scrub.value=0;scrub.setAttribute('aria-label','Scene time');
  const timeLabel=el('span','0.00 s');timeLabel.className='scene-time';timeLabel.setAttribute('aria-label','Current scene time');scrub.oninput=()=>{pause();time=Number(scrub.value);draw();};
  const guides=el('input');guides.type='checkbox';guides.checked=true;guides.setAttribute('aria-label','Show editing guides');guides.onchange=draw;
  const guideLabel=el('label','Guides');guideLabel.prepend(guides);
  transport.append(play,scrub,timeLabel,guideLabel,btn('Layers',()=>layerList.scrollIntoView({block:'start'})),btn('Selected piece',()=>inspector.scrollIntoView({block:'start'})));
  const editFields=el('fieldset');editFields.className='scene-edit-fields';
  const addBar=el('div');addBar.className='scene-toolbar';
  addBar.append(btn('Add image',()=>{pause(true);sourcePane?.dispose();sourcePane=openSceneSources(body,{request,onUpload,boardItems,onAdd:async asset=>{
    const scale=Math.min(scene.width*.75/(asset.width||scene.width),scene.height*.75/(asset.height||scene.height));
    const w=(asset.width||scene.width)*scale,h=(asset.height||scene.height)*scale;
    const layer=newLayer('image',scene,{name:(asset.name||'Image').slice(0,80),media_id:asset.media_id,x:(scene.width-w)/2,y:(scene.height-h)/2,w,h});
    change({op:'add',layer});selected=layer.id;render();
  },onClose:()=>{sourcePane=null;}});}),
    btn('Add shape',()=>add('shape')),btn('Add text',()=>add('text')),btn('Add group',()=>add('group')),btn('Add placement zone',()=>add('zone')),
    btn('Park starter',parkStarter));
  const history=el('div');history.className='scene-toolbar';const undoButton=btn('Undo scene',()=>restore(undo,redo)),redoButton=btn('Redo scene',()=>restore(redo,undo));history.append(undoButton,redoButton);
  const columns=el('div');columns.className='scene-columns';
  const layerList=el('div');layerList.className='scene-layers';layerList.setAttribute('aria-label','Scene layers');
  const inspector=el('div');inspector.className='scene-inspector';inspector.setAttribute('aria-label','Selected layer settings');
  columns.append(layerList,inspector);editFields.append(addBar,history,columns);
  const settings=el('details');settings.className='scene-settings';settings.append(el('summary','Scene size and duration'));
  const settingFields=el('div');settingFields.className='scene-form';
  number(settingFields,'Scene width',scene.width,40,2048,1,v=>change({op:'settings',patch:{width:v}}));
  number(settingFields,'Scene height',scene.height,40,2048,1,v=>change({op:'settings',patch:{height:v}}));
  number(settingFields,'Duration seconds',scene.duration,1,30,.1,v=>change({op:'settings',patch:{duration:v}}));
  const bg=el('input');bg.type='color';bg.value=scene.background==='transparent'?'#10251e':scene.background;bg.setAttribute('aria-label','Scene background color');bg.onchange=()=>change({op:'settings',patch:{background:bg.value}});settingFields.append(label('Background color',bg),btn('Transparent background',()=>change({op:'settings',patch:{background:'transparent'}})));settings.append(settingFields);
  const outputs=el('div');outputs.className='scene-toolbar';
  outputs.append(btn('Download PNG',()=>exportResult(false)),btn('Save PNG to board',()=>exportResult(true)),btn('Download animated HTML',()=>exportAnimation()));
  const help=el('p','Colors identify pieces and zones. Drag an unlocked piece; drag its lower-right corner to resize. Masks hide or reveal pixels. Groups move their children together. Motion affects any piece or group. Save the editable scene before leaving.');
  help.className='scene-help';body.append(status,actions,preview,transport,help,settings,editFields,outputs);host.append(header,body);document.body.append(host);
  host.querySelector('button').focus();
  function label(text,input){const l=el('label',text);l.append(input);return l;}
  function number(parent,name,value,min,max,step,run){
    const input=el('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=value;input.setAttribute('aria-label',name);
    input.onchange=()=>{try{run(Number(input.value));}catch(e){status.textContent=e.message;render();}};parent.append(label(name,input));return input;
  }
  function select(parent,name,value,options,run){
    const input=el('select');input.setAttribute('aria-label',name);for(const [v,t] of options)input.append(new Option(t,v));input.value=value;input.onchange=()=>{try{run(input.value);}catch(e){status.textContent=e.message;render();}};parent.append(label(name,input));return input;
  }
  function check(parent,name,value,run){const input=el('input');input.type='checkbox';input.checked=value;input.setAttribute('aria-label',name);input.onchange=()=>run(input.checked);parent.append(label(name,input));}
  function range(parent,name,value,min,max,step,run){
    const input=el('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.setAttribute('aria-label',name);input.onchange=()=>run(Number(input.value));parent.append(label(name,input));return input;
  }
  function remember(){undo.push(structuredClone(scene));if(undo.length>35)undo.shift();redo.length=0;}
  function mark(){dirty=true;saveState.textContent='Unsaved scene';discard.hidden=true;}
  function change(command){
    if(saving||disposed)throw Error('Wait for this scene to finish saving.');
    pause(true);const next=sceneCommand(scene,command);remember();scene=next;mark();refreshAssets();render();
  }
  function restore(from,to){if(!from.length||saving)return;pause(true);to.push(scene);scene=from.pop();mark();selected=scene.layers.some(l=>l.id===selected)?selected:(scene.layers.at(-1)?.id||'');refreshAssets();render();}
  function patch(p){try{change({op:'patch',id:selected,patch:p});}catch(e){status.textContent=e.message;render();}}
  function setPivot(pivot){
    const layer=scene.layers.find(l=>l.id===selected);if(!layer)return;
    const before=pose(layer,0,scene.duration),after=pose({...layer,pivot},0,scene.duration);
    patch({pivot,x:layer.x+before[4]-after[4],y:layer.y+before[5]-after[5]});
  }
  function add(type){const layer=newLayer(type,scene);change({op:'add',layer});selected=layer.id;masking=pivoting=false;render();}
  function pause(reset=false){playing=false;play.textContent='Play';if(reset)time=0;}
  function render(){
    for(const [name,value] of [['Scene width',scene.width],['Scene height',scene.height],['Duration seconds',scene.duration]]){const input=settingFields.querySelector('[aria-label="'+name+'"]');if(input&&document.activeElement!==input)input.value=value;}
    scrub.max=scene.duration;time=Math.min(time,scene.duration);undoButton.disabled=!undo.length;redoButton.disabled=!redo.length;
    layerList.replaceChildren(el('h3','Layers · front to back'));
    const ordered=worldLayers(scene,0).entries.slice().reverse();
    for(const {layer:l} of ordered){
      let depth=0,p=l.parent_id;while(p){depth++;p=scene.layers.find(x=>x.id===p)?.parent_id;}
      const button=btn((l.visible?'':'Hidden · ')+(l.locked?'Locked · ':'')+l.name,()=>{selected=l.id;masking=pivoting=false;pause(true);render();});
      button.setAttribute('aria-label','Select layer '+l.name);button.setAttribute('aria-pressed',String(selected===l.id));button.dataset.layerId=l.id;button.style.borderLeft='8px solid '+l.tag;button.style.marginLeft=(depth*10)+'px';layerList.append(button);
    }
    inspector.replaceChildren();
    const l=scene.layers.find(x=>x.id===selected);if(!l){inspector.append(el('p','Add a layer or select one from the list.'));draw();return;}
    inspector.append(el('h3',l.name));
    const identity=el('div');identity.className='scene-form';const name=el('input');name.type='text';name.maxLength=80;name.value=l.name;name.setAttribute('aria-label','Layer name');name.onchange=()=>patch({name:name.value});identity.append(label('Name',name));
    const guideColor=el('input');guideColor.type='color';guideColor.value=l.tag;guideColor.setAttribute('aria-label','Layer guide color');guideColor.onchange=()=>patch({tag:guideColor.value});identity.append(label('Guide color',guideColor));
    check(identity,'Layer visible',l.visible,v=>patch({visible:v}));check(identity,'Layer locked',l.locked,v=>patch({locked:v}));inspector.append(identity);
    const controls=el('fieldset');controls.disabled=worldLayers(scene,0).map.get(l.id)?.locked;controls.className='scene-layer-fields';inspector.append(controls);
    const tools=el('div');tools.className='scene-toolbar';
    tools.append(btn('Move layer forward',()=>change({op:'reorder',id:l.id,direction:'up'})),btn('Move layer backward',()=>change({op:'reorder',id:l.id,direction:'down'})),btn('Duplicate layer',()=>change({op:'duplicate',id:l.id})),btn('Remove layer',()=>{change({op:'remove',id:l.id});selected='';render();}));
    if(l.type==='image')tools.append(btn('Cut out layer',async()=>{
      pause(true);try{const {runCutter}=await import('./board-cut.js?v=20261030-6');runCutter({request,item:{media_id:l.media_id,title:l.name,w:l.w,h:l.h},onSaved:asset=>{
        if(disposed)return;const current=scene.layers.find(x=>x.id===l.id);if(!current)throw Error('The layer was removed. Your cutout is in the library.');change({op:'patch',id:l.id,patch:{media_id:asset.media_id}});
      }});}catch(e){status.textContent=e.message;}
    }));controls.append(tools);
    const form=el('div');form.className='scene-form';controls.append(form);
    select(form,'Parent group',l.parent_id,[['','No group'],...scene.layers.filter(x=>x.type==='group'&&x.id!==l.id).map(x=>[x.id,x.name])],parent_id=>patch({parent_id}));
    if(l.type!=='group'&&l.type!=='zone')select(form,'Keep inside zone',l.zone_id,[['','No placement zone'],...scene.layers.filter(x=>x.type==='zone'&&x.id!==l.id).map(x=>[x.id,x.name])],zone_id=>patch({zone_id}));
    for(const [key,title,min,max] of [['x','Layer X',-8192,8192],['y','Layer Y',-8192,8192],['w','Layer width',1,4096],['h','Layer height',1,4096],['rotation','Layer rotation',-3600,3600]])number(form,title,l[key],min,max,1,v=>patch({[key]:v}));
    range(form,'Layer opacity',l.opacity,0,1,.01,v=>patch({opacity:v}));
    range(form,'Pivot X',l.pivot.x,0,1,.01,v=>setPivot({...l.pivot,x:v}));range(form,'Pivot Y',l.pivot.y,0,1,.01,v=>setPivot({...l.pivot,y:v}));
    controls.append(btn(pivoting?'Tap the new pivot':'Set pivot on canvas',()=>{pause(true);pivoting=!pivoting;masking=false;status.textContent='Tap inside the selected piece to place its pivot.';render();preview.scrollIntoView({block:'center'});}));
    if(l.type==='shape'||l.type==='zone')select(form,'Layer shape',l.shape,[['rect','Rectangle'],['ellipse','Ellipse']],shape=>patch({shape}));
    if(['shape','zone','text'].includes(l.type)){const color=el('input');color.type='color';color.value=l.color;color.setAttribute('aria-label','Piece fill');color.onchange=()=>patch({color:color.value});form.append(label('Fill',color));}
    if(l.type==='text'){const text=el('input');text.type='text';text.maxLength=240;text.value=l.text;text.setAttribute('aria-label','Layer text');text.onchange=()=>patch({text:text.value});form.append(label('Text',text));number(form,'Font size',l.font_size,8,300,1,v=>patch({font_size:v}));}
    if(!['group','zone'].includes(l.type)){
    select(form,'Blend mode',l.blend,[['source-over','Normal'],['multiply','Multiply · shadows'],['screen','Screen · light']],blend=>patch({blend}));
    check(form,'Cast shadow',!!l.shadow,enabled=>patch({shadow:enabled?{color:'#000000',blur:18,dx:10,dy:16}:undefined}));
    if(l.shadow){number(form,'Shadow blur',l.shadow.blur,0,100,1,v=>patch({shadow:{...l.shadow,blur:v}}));}
    }
    const motion=el('details');motion.open=l.motion.kind!=='none';motion.append(el('summary','Puppet and motion'));const motionFields=el('div');motionFields.className='scene-form';motion.append(motionFields);
    select(motionFields,'Layer motion',l.motion.kind,MOTIONS.map(m=>[m,({none:'Still',sway:'Sway / pivot',bob:'Float up and down',travel:'Travel along path',pulse:'Pulse',flap:'Flap / wave',talk:'Mouth opening (not lip sync)'})[m]]),kind=>patch({motion:{...l.motion,kind}}));
    number(motionFields,'Motion strength',l.motion.amount,0,200,1,v=>patch({motion:{...l.motion,amount:v}}));number(motionFields,'Motion period',l.motion.period,.2,30,.1,v=>patch({motion:{...l.motion,period:v}}));range(motionFields,'Motion phase',l.motion.phase,0,1,.01,v=>patch({motion:{...l.motion,phase:v}}));
    number(motionFields,'Path X distance',l.motion.dx,-4096,4096,1,v=>patch({motion:{...l.motion,dx:v}}));number(motionFields,'Path Y distance',l.motion.dy,-4096,4096,1,v=>patch({motion:{...l.motion,dy:v}}));controls.append(motion);
    if(!['group','zone'].includes(l.type)){
      const masks=el('details');masks.open=!!l.mask;masks.append(el('summary','Paint mask'));const mf=el('div');mf.className='scene-form';masks.append(mf);
      select(mf,'Mask coverage',l.mask?.base||'none',[['none','No mask · whole piece'],['hidden','Only reveal painted area'],['visible','Hide painted areas']],base=>{masking=false;patch({mask:base==='none'?undefined:{base,strokes:l.mask?.strokes||[]}});});
      const brush=el('select');brush.setAttribute('aria-label','Mask brush size');for(const [v,t] of [['.025','Small'],['.065','Medium'],['.14','Large']])brush.append(new Option(t,v));brush.value=host.dataset.brush||'.025';brush.onchange=()=>host.dataset.brush=brush.value;mf.append(label('Brush size',brush));
      const op=el('select');op.setAttribute('aria-label','Mask paint operation');op.append(new Option('Reveal pixels','add'),new Option('Hide pixels','subtract'));op.value=host.dataset.maskOp||(l.mask?.base==='hidden'?'add':'subtract');op.onchange=()=>host.dataset.maskOp=op.value;mf.append(label('Paint action',op));
      masks.append(btn(masking?'Stop mask painting':'Paint selected mask',()=>{pause(true);masking=!masking;pivoting=false;status.textContent=masking?'Paint on the selected piece. Its color is the guide; Undo restores the last stroke.':'Mask painting stopped.';render();if(masking)preview.scrollIntoView({block:'center'});}),btn('Clear layer mask',()=>{masking=false;patch({mask:undefined});}));controls.append(masks);
    }
    updateDisabled();draw();
  }
  function updateDisabled(){editFields.disabled=saving;save.disabled=saving;settings.querySelectorAll('input,button').forEach(n=>n.disabled=saving);}
  function draw(){
    if(disposed)return;const s=Math.min(1,720/scene.width,720/scene.height);canvas.width=Math.round(scene.width*s);canvas.height=Math.round(scene.height*s);
    renderer.draw(canvas,scene,time,{selected,guides:guides.checked,masking});scrub.value=time;timeLabel.textContent=time.toFixed(2)+' s';
    const l=scene.layers.find(l=>l.id===selected);if(l&&guides.checked&&!l.locked){const e=worldLayers(scene,time).map.get(l.id);if(e){const p=point(e.matrix,l.w,l.h),c=canvas.getContext('2d');c.fillStyle=l.tag;c.fillRect(p.x*s-6,p.y*s-6,12,12);}}
  }
  function refreshAssets(){
    const key=mediaIds(scene).sort().join(',');if(key===loadedKey&&!loading){draw();return;}
    const generation=++loadGeneration,snapshot=structuredClone(scene);loading=true;assetError=null;status.textContent='Loading scene images…';
    loadChain=loadChain.catch(()=>{}).then(()=>renderer.load(snapshot)).then(()=>{if(disposed||generation!==loadGeneration)return;loadedKey=key;loading=false;draw();status.textContent='Scene ready. Select a piece to edit it.';}).catch(e=>{if(!disposed&&generation===loadGeneration){loading=false;assetError=e.message||'Could not load a scene image.';status.textContent=assetError;}});
  }
  function localEvent(e,entry){const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*scene.width,y=(e.clientY-r.top)/r.height*scene.height;return {world:{x,y},local:entry?point(inverse(entry.matrix),x,y):null};}
  canvas.onpointerdown=e=>{
    if(saving||loading||playing)return;const map=worldLayers(scene,0).map;let l=scene.layers.find(x=>x.id===selected),entry=map.get(selected),p=localEvent(e,entry);
    if(pivoting&&l&&!entry.locked){const x=Math.max(0,Math.min(1,p.local.x/l.w)),y=Math.max(0,Math.min(1,p.local.y/l.h));pivoting=false;setPivot({x,y});return;}
    if(masking&&l&&!entry.locked&&!['group','zone'].includes(l.type)){
      const stroke={op:host.dataset.maskOp||(l.mask?.base==='hidden'?'add':'subtract'),size:Number(host.dataset.brush||'.025'),points:[[Math.max(0,Math.min(1,p.local.x/l.w)),Math.max(0,Math.min(1,p.local.y/l.h))]]};
      gesture={kind:'mask',before:structuredClone(scene),id:l.id,stroke};canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
    }
    const handle=l&&entry&&!entry.locked&&Math.abs(p.local.x-l.w)<20*scene.width/canvas.clientWidth&&Math.abs(p.local.y-l.h)<20*scene.height/canvas.clientHeight;
    const hit=handle?selected:hitLayer(scene,0,p.world.x,p.world.y);if(!hit)return;selected=hit;l=scene.layers.find(x=>x.id===hit);entry=map.get(hit);p=localEvent(e,entry);
    const parent=l.parent_id?map.get(l.parent_id).matrix:[1,0,0,1,0,0];gesture={kind:handle?'resize':'drag',before:structuredClone(scene),id:hit,x:e.clientX,y:e.clientY,layer:{...l},matrix:entry.matrix,parent};
    canvas.setPointerCapture(e.pointerId);e.preventDefault();render();
  };
  canvas.onpointermove=e=>{
    if(!gesture||saving)return;const l=scene.layers.find(l=>l.id===gesture.id);if(!l)return;
    if(gesture.kind==='mask'){
      const p=localEvent(e,worldLayers(scene,0).map.get(l.id)).local,pt=[Math.max(0,Math.min(1,p.x/l.w)),Math.max(0,Math.min(1,p.y/l.h))],points=gesture.stroke.points;
      if(points.length<160&&Math.hypot(pt[0]-points.at(-1)[0],pt[1]-points.at(-1)[1])>.002)points.push(pt);
      try{const previewScene=sceneCommand(gesture.before,{op:'mask_stroke',id:l.id,stroke:gesture.stroke});renderer.draw(canvas,previewScene,0,{selected,guides:true,masking:true});}catch(error){status.textContent=error.message;}return;
    }
    const r=canvas.getBoundingClientRect(),dx=(e.clientX-gesture.x)/r.width*scene.width,dy=(e.clientY-gesture.y)/r.height*scene.height;
    if(gesture.kind==='drag'){const m=inverse(gesture.parent),origin=point(m,0,0),delta=point(m,dx,dy);l.x=gesture.layer.x+delta.x-origin.x;l.y=gesture.layer.y+delta.y-origin.y;}
    else{const m=inverse(gesture.matrix),origin=point(m,0,0),delta=point(m,dx,dy);l.w=Math.max(1,Math.min(4096,gesture.layer.w+delta.x-origin.x));l.h=Math.max(1,Math.min(4096,gesture.layer.h+delta.y-origin.y));}
    draw();
  };
  function endGesture(){
    if(!gesture)return;const g=gesture;gesture=null;
    try{if(g.kind==='mask')scene=sceneCommand(g.before,{op:'mask_stroke',id:g.id,stroke:g.stroke});else scene=cleanScene(scene);
      undo.push(g.before);if(undo.length>35)undo.shift();redo.length=0;mark();render();
    }catch(e){scene=g.before;status.textContent=e.message;render();}
  }
  canvas.onpointerup=endGesture;canvas.onpointercancel=()=>{if(gesture){scene=gesture.before;gesture=null;render();}};
  function tick(now){if(disposed)return;if(playing&&!loading){if(now-last>=40){time=(time+(now-last)/1000)%scene.duration;draw();last=now;}}else last=now;raf=requestAnimationFrame(tick);}
  function download(blob,name){const url=URL.createObjectURL(blob);urls.add(url);const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},30000);}
  async function exportResult(toBoard){
    if(assetError){status.textContent=assetError;return;}
    if(loading||saving){status.textContent='Wait for the scene to finish loading or saving.';return;}
    pause();status.textContent='Exporting the current frame…';
    try{const output=el('canvas');output.width=scene.width;output.height=scene.height;renderer.draw(output,scene,time);
      const blob=await new Promise((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(Error('PNG export failed.')),'image/png'));
      if(disposed)return;
      if(toBoard){saving=true;updateDisabled();const inputs=mediaIds(scene),attribution=[...renderer.images.values()].map(x=>x.asset.provenance?.attribution||x.asset.description||'').filter(Boolean).join(' | ').slice(0,500);
        const asset=await savePngAsset({request,blob,width:scene.width,height:scene.height,name:(item?.title||'Layered scene')+' frame',provenance:inputs.length?{role:'output',origin:'derived',parent_ids:inputs.slice(0,8),attribution,notes:JSON.stringify({tool:'board-scene',scene_item_id:item?.id||'',time,input_count:inputs.length,parent_ids_truncated:inputs.length>8})}:{role:'original',origin:'generated',notes:'Frame from a code-created scene.'}});
        if(!disposed)await onExport(asset);
      }else download(blob,'Nexus scene.png');
      if(!disposed)status.textContent=toBoard?'PNG saved to the library and board. Keep the editable scene for future changes.':'PNG download requested. Your editable layers remain separate.';
    }catch(e){if(!disposed)status.textContent=e.message;}finally{saving=false;updateDisabled();}
  }
  function exportAnimation(){if(assetError){status.textContent=assetError;return;}if(loading||saving)return;pause();try{download(new Blob([animatedSceneHtml(scene,renderer)],{type:'text/html'}),'Nexus animated scene.html');status.textContent='Animated HTML download requested. It includes the layers and local play/pause controls; this is not an MP4.';}catch(e){status.textContent=e.message;}}
  function parkStarter(){
    try{
      const next=structuredClone(scene),w=next.width,h=next.height;const layers=[];
      const add=(type,extra)=>{const l=newLayer(type,{...next,layers:[...next.layers,...layers]},extra);layers.push(l);return l;};
      add('shape',{name:'Park sky',x:0,y:0,w,h,color:'#9ddde5'});
      add('shape',{name:'Sun',shape:'ellipse',x:w*.72,y:h*.08,w:w*.16,h:w*.16,color:'#f9d778',motion:{kind:'bob',amount:8,period:5}});
      add('shape',{name:'Grass',x:0,y:h*.6,w,h:h*.4,color:'#559b61'});
      add('shape',{name:'Path',x:w*.45,y:h*.6,w:w*.22,h:h*.4,color:'#d5bc8b'});
      for(const x of [.05,.76]){
        const g=add('group',{name:x<.5?'Left tree':'Right tree',x:x*w,y:h*.22,w:w*.25,h:h*.5,pivot:{x:.5,y:1},motion:{kind:'sway',amount:2,period:4}});
        add('shape',{name:'Tree trunk',parent_id:g.id,x:w*.1,y:h*.15,w:w*.05,h:h*.35,color:'#855d3b'});
        add('shape',{name:'Tree leaves',parent_id:g.id,shape:'ellipse',x:0,y:0,w:w*.25,h:h*.3,color:'#347b50'});
      }
      const bird=add('group',{name:'Bird puppet',x:w*.12,y:h*.16,w:100,h:60,motion:{kind:'travel',dx:w*.6,dy:h*.06}});
      add('shape',{name:'Bird body',parent_id:bird.id,shape:'ellipse',x:36,y:22,w:38,h:18,color:'#28384d'});
      add('shape',{name:'Bird left wing',parent_id:bird.id,shape:'ellipse',x:0,y:10,w:50,h:14,color:'#28384d',pivot:{x:1,y:.5},motion:{kind:'flap',amount:30,period:.8}});
      add('shape',{name:'Bird right wing',parent_id:bird.id,shape:'ellipse',x:60,y:10,w:50,h:14,color:'#28384d',pivot:{x:0,y:.5},motion:{kind:'flap',amount:30,period:.8,phase:.5}});
      next.layers=[...layers,...next.layers];const valid=cleanScene(next);remember();scene=valid;mark();refreshAssets();render();status.textContent='Stylized park added as separate scenery, tree groups and a moving bird puppet. Add real park imagery through Image lookup.';
    }catch(e){status.textContent=e.message;}
  }
  function close(){if(saving)return;if(dirty){discard.hidden=false;status.textContent='Save this editable scene, or choose Discard scene changes.';actions.scrollIntoView({block:'nearest'});return;}dispose();}
  function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);sourcePane?.dispose();renderer.dispose();for(const url of urls)URL.revokeObjectURL(url);host.remove();if(window.nexusScene===api)delete window.nexusScene;previousFocus?.focus?.();}
  const api={
    get targetId(){return item?.id||'';},get scene(){return structuredClone(scene);},get selected(){return selected;},
    command:change,select(id){if(!scene.layers.some(l=>l.id===id))throw Error('Layer not found.');selected=id;render();},
    play(){playing=true;last=performance.now();play.textContent='Pause';},pause(){pause();},
    seek(value){if(!Number.isFinite(value))throw Error('Use a numeric scene time.');pause();time=Math.max(0,Math.min(scene.duration,value));draw();}
  };window.nexusScene=api;
  host.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...host.querySelectorAll('button,input,select,textarea,summary')].filter(n=>!n.matches(':disabled')&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  render();refreshAssets();raf=requestAnimationFrame(tick);
  return api;
}
