// Nexus Board: a free-form surface for anything visual. Items are inline visuals, Lab pictures/clips/audio,
// notes and hand sketches. Boards are saved per owner through /api/nexus-lab (board_* actions); media stays in
// the shared Lab library and is only referenced by id. Workflows can plug in through window.nexusBoard.
import {ZOOM_MIN,ZOOM_MAX,clamp,buildVisualDocument,screenToWorld,zoomAt,fitView,addPoint,strokePath,inRect,newId,LOOKS,SWATCHES,INK,lookGrid} from './board-core.js?v=20261030-6';

const $=id=>document.getElementById(id);
const viewport=$('viewport'),world=$('world'),selbar=$('selbar'),drawbar=$('drawbar'),sheetHost=$('sheetHost'),nameInput=$('boardName'),saveState=$('saveState'),emptyNote=$('empty'),toastEl=$('toast');
const LIMITS={items:150,strokes:200,points:6000,pointsPerStroke:400};
const SVGNS='http://www.w3.org/2000/svg';
function h(tag,props={},...kids){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k.startsWith('on'))n[k]=v;else if(v===true)n.setAttribute(k,'');else if(v!==false&&v!=null)n.setAttribute(k,v);}n.append(...kids.flat().filter(k=>k!=null));return n;}

let board=null,selId=null,liveId=null,mode='select',ink={c:INK[0],s:6},drawItemId=null;
let dirty=false,saving=false,again=false,locked=false,saveTimer=null,toastTimer=null;
const scenePlayers=new Map();
const els=new Map(),ptrs=new Map(),media=new Map();let gesture=null;

async function request(body){
  const r=await fetch('/api/nexus-lab',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
  let data={};try{data=await r.json();}catch{}
  if(!r.ok){const e=new Error(data.error||'That did not work. Try again.');e.status=r.status;throw e;}
  return data;
}
function toast(message,bad=false){toastEl.textContent=message;toastEl.className=bad?'toast err':'toast';toastEl.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toastEl.hidden=true;},bad?5000:2600);}
function setState(text,bad=false){saveState.textContent=text;saveState.className=bad?'save err':'save';}
const remember=()=>{try{if(board?.id)localStorage.setItem('nexus-board-last',board.id);}catch{}};
const lastId=()=>{try{return new URLSearchParams(location.search).get('id')||localStorage.getItem('nexus-board-last')||'';}catch{return '';}};

// ---- saving -------------------------------------------------------------
function touch(){if(locked)return;dirty=true;setState('Unsaved');clearTimeout(saveTimer);saveTimer=setTimeout(flush,1200);window.dispatchEvent(new CustomEvent('nexus-board:change'));}
async function flush(){
  clearTimeout(saveTimer);if(locked||!dirty||!board)return;if(saving){again=true;return;}
  saving=true;dirty=false;setState('Saving…');
  const view=board.view,snapshot={...(board.id?{id:board.id}:{}),name:board.name,look:board.look,bg:board.bg||'',view:{x:Math.round(view.x),y:Math.round(view.y),z:Math.round(view.z*1000)/1000},items:board.items};
  try{
    const {board:saved}=await request({action:'board_save',input:{board:snapshot,...(board.id?{base_rev:board.rev}:{})}});
    board.id=saved.id;board.rev=saved.rev;remember();setState(dirty?'Unsaved':'Saved');
  }catch(e){
    if(e.status===409&&board.id){locked=true;setState('Changed elsewhere',true);conflictSheet(e.message);}
    else{dirty=true;setState('Not saved',true);toast(e.message,true);if(!e.status||e.status>=500)saveTimer=setTimeout(flush,6000);}
  }finally{saving=false;window.dispatchEvent(new Event('nexus-board:save-settled'));if(again){again=false;if(dirty)flush();}}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});

// ---- items --------------------------------------------------------------
const maxZ=()=>board.items.reduce((m,i)=>Math.max(m,i.z),0);
const byId=id=>board.items.find(i=>i.id===id);
function renumber(){board.items.sort((a,b)=>a.z-b.z).forEach((it,i)=>{it.z=i;});}
function center(){const p=screenToWorld(board.view,{x:innerWidth/2,y:innerHeight/2-40});return p;}
function fitBox(w,h,max=320){const s=Math.min(1,max/Math.max(w||max,h||max));return {w:Math.max(40,Math.round((w||max)*s)),h:Math.max(40,Math.round((h||max)*s))};}
function addItem(partial,{select=true}={}){
  if(board.items.length>=LIMITS.items){toast(`A board holds up to ${LIMITS.items} items.`,true);return null;}
  const c=center(),w=partial.w||280,h=partial.h||200;
  const it={id:newId(),title:'',...partial,w,h,x:Math.round(partial.x??c.x-w/2),y:Math.round(partial.y??c.y-h/2),z:maxZ()+1};
  board.items.push(it);if(select)choose(it.id);else render();touch();return it;
}
function updateItem(id,patch){const it=byId(id);if(!it)return null;Object.assign(it,patch);render();touch();return it;}
function removeItem(id){board.items=board.items.filter(i=>i.id!==id);if(selId===id)selId=null;if(liveId===id)liveId=null;render();touch();}
function choose(id){selId=id;if(liveId&&liveId!==id)liveId=null;render();window.dispatchEvent(new CustomEvent('nexus-board:select',{detail:{id}}));}

// ---- media from the Lab library ----------------------------------------------
const dec=v=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
function mediaUrl(id){
  if(!media.has(id))media.set(id,(async()=>{
    const {asset}=await request({action:'asset_read',input:{media_id:id}});if(asset.status!=='ready')throw Error('This file is not finished uploading.');
    const parts=[];for(let i=0;i<asset.chunks;i++){const c=await request({action:'asset_download',input:{media_id:id,index:i}});if(c.media_id!==id||c.index!==i)throw Error('The download does not match.');parts.push(dec(c.data_base64));}
    return URL.createObjectURL(new Blob(parts,{type:asset.mime}));
  })().catch(e=>{media.delete(id);throw e;}));
  return media.get(id);
}

// ---- rendering -------------------------------------------------------------
function makeEl(it){
  const el=h('div',{class:`bitem k-${it.kind}`,'data-id':it.id});
  if(it.kind==='visual')el.append(h('iframe',{sandbox:'allow-scripts',referrerpolicy:'no-referrer',title:it.title||'Inline visual'}));
  else if(it.kind==='image'||it.kind==='video'||it.kind==='audio'){
    el.append(h('div',{class:'loading',text:'Loading…'}));
    mediaUrl(it.media_id).then(url=>{if(els.get(it.id)!==el)return;const m=h(it.kind==='image'?'img':it.kind,it.kind==='image'?{alt:it.title||'Board picture',src:url}:{src:url,playsinline:true,preload:'metadata'});if(it.kind==='video'&&it.loop)m.loop=true;el.querySelector('.loading')?.remove();el.prepend(m);})
      .catch(e=>{const l=el.querySelector('.loading');if(l)l.textContent=e.message||'Could not load this file.';});
  }else if(it.kind==='scene'){
    const canvas=h('canvas',{'aria-label':it.title||'Animated scene'});el.append(canvas);
    import('./board-scene-tile.js?v=20261030-scene1').then(({mountSceneTile})=>{
      if(els.get(it.id)!==el)return;
      const player=mountSceneTile(canvas,{request,scene:byId(it.id)?.scene||it.scene,onError:message=>toast(message,true)});scenePlayers.set(it.id,player);
    }).catch(e=>toast(e.message,true));
  }
  else if(it.kind==='sketch'){const svg=document.createElementNS(SVGNS,'svg');svg.setAttribute('class','sk');svg.setAttribute('preserveAspectRatio','none');el.append(svg);}
  else if(it.kind==='note')el.append(h('div',{class:'txt'}));
  return el;
}
function updateEl(el,it){
  const s=el.style;s.left=it.x+'px';s.top=it.y+'px';s.width=it.w+'px';s.height=it.h+'px';s.zIndex=it.z;
  el.classList.toggle('sel',selId===it.id);el.classList.toggle('live',liveId===it.id);
  if(it.kind==='visual'){const f=el.querySelector('iframe');if(f.dataset.code!==it.html){f.dataset.code=it.html;f.srcdoc=buildVisualDocument(it.html);}f.title=it.title||'Inline visual';}
  else if(it.kind==='note'){el.className=`bitem k-note c-${it.color||'gold'}${selId===it.id?' sel':''}`;const t=el.querySelector('.txt');if(t.textContent!==it.text)t.textContent=it.text;}
  else if(it.kind==='scene'){scenePlayers.get(it.id)?.update(it.scene);}
  else if(it.kind==='sketch'){const svg=el.querySelector('svg'),sig=it.strokes.length+':'+it.strokes.reduce((n,x)=>n+x.p.length,0)+`:${it.w}x${it.h}`;
    if(svg.dataset.sig!==sig){svg.dataset.sig=sig;svg.setAttribute('viewBox',`0 0 ${it.w} ${it.h}`);svg.replaceChildren(...it.strokes.flatMap(st=>{const mk=(color,width,hit)=>{const p=document.createElementNS(SVGNS,'path');p.setAttribute('d',strokePath(st.p));p.setAttribute('fill','none');p.setAttribute('stroke',color);p.setAttribute('stroke-width',width);p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');if(hit)p.setAttribute('class','hit');return p;};return [mk(st.c,st.s,false),mk('transparent',Math.max(st.s,24),true)];}));}}
  else{const m=el.querySelector('video,audio');if(m){m.controls=liveId===it.id;}}
  el.querySelector('.handle')?.remove();
  if(selId===it.id&&mode==='select')el.append(h('div',{class:'handle','aria-label':'Resize','data-handle':'1',text:'↘'}));
  const cap=el.querySelector('.cap');if(it.title&&(it.kind==='image'||it.kind==='video'||it.kind==='audio'||it.kind==='scene')){if(!cap)el.append(h('div',{class:'cap',text:it.title}));else cap.textContent=it.title;}
}
function applyView(){
  const v=board.view;world.style.transform=`translate(${v.x}px,${v.y}px) scale(${v.z})`;
  const g=lookGrid[board.look]||0;viewport.style.backgroundSize=g?`${g*v.z}px ${g*v.z}px`:'';viewport.style.backgroundPosition=g?`${v.x}px ${v.y}px`:'';
}
function render(){
  viewport.className=`viewport look-${board.look}${mode==='draw'?' drawing':''}`;viewport.style.backgroundColor=board.bg||'';
  applyView();const seen=new Set();
  for(const it of board.items){seen.add(it.id);let el=els.get(it.id);if(!el){el=makeEl(it);els.set(it.id,el);world.append(el);}updateEl(el,it);}
  for(const [id,el] of [...els])if(!seen.has(id)){scenePlayers.get(id)?.dispose();scenePlayers.delete(id);el.remove();els.delete(id);}
  emptyNote.hidden=board.items.length>0;if(document.activeElement!==nameInput)nameInput.value=board.name;
  $('drawBtn').setAttribute('aria-pressed',String(mode==='draw'));drawbar.hidden=mode!=='draw';
  drawSelbar();if(mode==='draw')drawBar();
}

// ---- selected item tools -----------------------------------------------------
const hooks=[];
function btn(label,run,cls='',pressed){const b=h('button',{type:'button',class:cls,text:label,...(pressed!==undefined?{'aria-pressed':String(pressed)}:{})});b.onclick=run;return b;}
function drawSelbar(){
  const it=selId&&mode==='select'?byId(selId):null;selbar.hidden=!it;if(!it)return;selbar.replaceChildren();
  const add=(...b)=>selbar.append(...b);
  if(it.kind==='visual')add(btn('Edit',()=>visualSheet(it)),btn('Interact',()=>{liveId=liveId===it.id?null:it.id;render();},'',liveId===it.id));
  if(it.kind==='note')add(btn('Edit',()=>noteSheet(it)),btn('Color',()=>{const order=['gold','green','sky','rose','paper'];updateItem(it.id,{color:order[(order.indexOf(it.color||'gold')+1)%order.length]});}));
  if(it.kind==='image')add(btn('Cut out',()=>openCutter(it)),btn('Background',()=>openComposer(it)),btn('Compose scene',()=>openScene(it)));
  if(it.kind==='scene')add(btn('Edit scene',()=>openScene(it)),btn('Play / pause scene',()=>{const p=scenePlayers.get(it.id);if(p)p.playing?p.pause():p.play();}),btn('Add scene controls',async()=>{
    const {sceneControlsHtml}=await import('./board-scene-render.js?v=20261030-scene1');
    addItem({kind:'visual',title:'Scene controls',scene_target_id:it.id,html:sceneControlsHtml(it.id,it.scene.duration),w:320,h:240,x:it.x+it.w+24,y:it.y});
  }));
  if(it.kind==='video'||it.kind==='audio')add(btn('Controls',()=>{liveId=liveId===it.id?null:it.id;render();},'',liveId===it.id));
  if(it.kind==='sketch')add(btn('Undo stroke',()=>{it.strokes.pop();render();touch();}));
  if(it.kind!=='sketch')add(btn('Rename',()=>renameSheet(it)));
  for(const a of hooks)if(!a.kinds||a.kinds.includes(it.kind))add(btn(a.label,()=>{try{a.run(structuredClone(it),api);}catch(e){toast(e.message||'That action failed.',true);}}));
  add(btn('Front',()=>{it.z=maxZ()+1;renumber();render();touch();}),btn('Back',()=>{it.z=-1;renumber();render();touch();}),
    btn('Duplicate',()=>{const c=structuredClone(it);c.id=newId();c.x+=24;c.y+=24;c.z=maxZ()+1;board.items.push(c);choose(c.id);touch();}),
    btn('Delete',()=>removeItem(it.id),'warn'));
}

// ---- sheets ------------------------------------------------------------------
function sheet(title,sub,...content){
  closeSheet();const back=h('div',{class:'sheet-back',role:'dialog','aria-modal':'true','aria-label':title});
  const s=h('div',{class:'sheet'},h('button',{class:'close',type:'button','aria-label':'Close',text:'✕',onclick:closeSheet}),h('h2',{text:title}),sub?h('p',{class:'sub',text:sub}):null,...content);
  back.append(s);back.onclick=e=>{if(e.target===back)closeSheet();};sheetHost.append(back);return s;
}
function closeSheet(){sheetHost.replaceChildren();}
function addSheet(){
  const big=(t,sm,run)=>{const b=h('button',{class:'big',type:'button'},t,h('small',{text:sm}));b.onclick=run;return b;};
  sheet('Add to the board','Anything works. Nothing here is limited to one kind of thing.',h('div',{class:'row col'},
    big('Social Post Flow','Video branches, captions and social posting queue',()=>{location.href='/social-post-flow.html';}),
    big('Layered scene','Images, masks, puppets and local animation tools',()=>{closeSheet();openScene();}),
    big('Inline visual','Paste HTML or SVG, like one Claude drew in chat',()=>visualSheet()),
    big('Picture, clip or sound from your library','Everything in your Nexus Lab media',()=>librarySheet()),
    big('Upload a file','A picture, video or audio file from this phone',()=>pickFile()),
    big('Note','A quick sticky note',()=>noteSheet()),
    big('Draw','Sketch right on the board',()=>{closeSheet();setMode('draw');})));
}
function visualSheet(existing){
  const ta=h('textarea',{'aria-label':'Visual code',placeholder:'<svg viewBox="0 0 200 120">…</svg>',spellcheck:'false'});ta.value=existing?.html||'';
  const msg=h('p',{class:'err'});
  const go=btn(existing?'Save changes':'Add to board',()=>{const code=ta.value;if(!code.trim()){msg.textContent='Paste some HTML or SVG first.';return;}
    if(new Blob([code]).size>40000){msg.textContent='That is too large for a board (40 KB limit).';return;}
    if(existing){updateItem(existing.id,{html:code});}else{const looksSvg=/^\s*<svg/i.test(code),vb=code.match(/viewBox=["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i);addItem({kind:'visual',html:code,...(looksSvg&&vb?fitBox(+vb[1],+vb[2],340):{w:320,h:240})});}
    closeSheet();},'gold');go.className='big gold';
  sheet(existing?'Edit visual':'Inline visual','It runs in a sealed frame: no network, no saved data, and it cannot touch the rest of Nexus.',ta,msg,h('div',{class:'row'},go));
  setTimeout(()=>ta.focus(),50);
}
function noteSheet(existing){
  const ta=h('textarea',{'aria-label':'Note text'});ta.value=existing?.text||'';ta.style.minHeight='120px';ta.style.font='16px Georgia,serif';
  const go=h('button',{class:'big gold',type:'button',text:existing?'Save':'Add note'});go.onclick=()=>{const t=ta.value.slice(0,2000);if(existing)updateItem(existing.id,{text:t});else addItem({kind:'note',text:t,color:'gold',w:200,h:150});closeSheet();};
  sheet(existing?'Edit note':'New note','',ta,h('div',{class:'row'},go));setTimeout(()=>ta.focus(),50);
}
function renameSheet(it){
  const input=h('input',{type:'text',maxlength:'80','aria-label':'Name',value:it.title||''});const go=h('button',{class:'big gold',type:'button',text:'Save'});
  go.onclick=()=>{updateItem(it.id,{title:input.value.trim().slice(0,80)});closeSheet();};sheet('Name this item','',input,h('div',{class:'row'},go));setTimeout(()=>input.focus(),50);
}
async function librarySheet(){
  const grid=h('div',{class:'grid'}),msg=h('p',{class:'sub',text:'Loading your library…'});
  sheet('Your library','Tap something to put it on the board.',msg,grid,h('div',{class:'row'},btn('Upload a file instead',pickFile,'big')));
  try{
    const {media:list}=await request({action:'asset_list',input:{}});const ready=list.filter(m=>m.status==='ready');
    msg.textContent=ready.length?`${ready.length} item${ready.length===1?'':'s'} in your library.`:'Your library is empty. Upload a file to start.';
    for(const m of ready){const t=h('button',{class:'tile',type:'button','aria-label':`Add ${m.name}`},h('span',{text:`${m.kind==='image'?'':m.kind+' · '}${m.name}`}));if(m.preview&&/^data:image\//.test(m.preview))t.style.backgroundImage=`url("${m.preview}")`;
      t.onclick=()=>{const box=m.kind==='audio'?{w:300,h:72}:fitBox(m.width,m.height);addItem({kind:m.kind,media_id:m.media_id,title:m.name.replace(/\.[a-z0-9]+$/i,'').slice(0,80),...box});closeSheet();};grid.append(t);}
  }catch(e){msg.textContent=e.message;msg.className='err';}
}
function pickFile(){
  const input=h('input',{type:'file',accept:'image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/*'});
  input.onchange=async()=>{const f=input.files?.[0];if(!f)return;closeSheet();toast(`Uploading ${f.name}…`);try{const asset=await uploadFile(f);const box=asset.kind==='audio'?{w:300,h:72}:fitBox(asset.width,asset.height);addItem({kind:asset.kind,media_id:asset.media_id,title:f.name.replace(/\.[a-z0-9]+$/i,'').slice(0,80),...box});toast('Uploaded to your library.');}catch(e){toast(e.message,true);}};
  input.click();
}
const hex=buf=>Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
const b64=bytes=>{let t='';for(let i=0;i<bytes.length;i+=8192)t+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(t);};
async function uploadFile(file){
  const kind=/^image\//.test(file.type)||/\.(png|jpe?g|webp)$/i.test(file.name)?'image':/^audio\//.test(file.type)||/\.(mp3|wav|ogg|m4a)$/i.test(file.name)?'audio':/^video\//.test(file.type)||/\.(mp4|mov|webm)$/i.test(file.name)?'video':'';
  if(!kind)throw Error('Choose a PNG, JPEG, WebP, MP4, MOV, WebM or audio file.');
  const bytes=await file.arrayBuffer(),sha=hex(await crypto.subtle.digest('SHA-256',bytes));let dims={};
  if(kind==='image'){try{const bm=await createImageBitmap(file);dims={width:bm.width,height:bm.height};bm.close?.();}catch{}}
  const {limits}=await request({action:'asset_list',input:{}});
  const {asset}=await request({action:'asset_begin',request_id:crypto.randomUUID(),input:{name:file.name.slice(0,80),kind,bytes:bytes.byteLength,sha256:sha,...dims,provenance:{role:'original',origin:'uploaded'}}});
  const size=limits.chunkBytes;for(let i=0;i<asset.chunks;i++)await request({action:'asset_chunk',input:{media_id:asset.media_id,index:i,data_base64:b64(new Uint8Array(bytes,i*size,Math.min(size,bytes.byteLength-i*size)))}});
  return (await request({action:'asset_finish',input:{media_id:asset.media_id}})).asset;
}
async function openCutter(it){
  try{const {runCutter}=await import('./board-cut.js?v=20261030-6');
    runCutter({request,item:it,onSaved:asset=>{addItem({kind:'image',media_id:asset.media_id,title:(it.title?it.title+' ':'')+'cutout',w:it.w,h:it.h,x:it.x+it.w+24,y:it.y});toast('Cutout saved to your library and added.');}});
  }catch(e){toast(e.message||'Could not open the cutter.',true);}
}
async function openComposer(it){
  if(board.items.length>=LIMITS.items){toast('This board is full. Make room before composing.',true);return;}
  const target=board;
  try{const {runComposer}=await import('./board-compose.js?v=20261030-sources1');
    runComposer({request,item:it,boardItems:board.items.map(i=>({...i})),onUpload:uploadFile,onSaved:asset=>{
      if(board!==target)throw Error('The board changed. Your image is saved in the library; reopen it from Add.');
      const box=fitBox(asset.width,asset.height,340);
      const added=addItem({kind:'image',media_id:asset.media_id,title:asset.name.slice(0,80),...box,x:it.x+it.w+24,y:it.y});
      if(!added)throw Error('The board is full. Your image is saved in the library; add it after making room.');
      flush();
    }});
  }catch(e){toast(e.message||'Could not open composition.',true);}
}
async function saveBoardNow(){
  for(let attempt=0;attempt<3;attempt++){
    if(saving)await new Promise(resolve=>window.addEventListener('nexus-board:save-settled',resolve,{once:true}));
    await flush();if(!saving&&!dirty&&!locked)return;
    if(locked)throw Error('This board changed elsewhere. Reload before saving this scene.');
  }
  throw Error('The board has not finished saving. Your draft is still open; try Save editable scene again.');
}
async function commitSceneBoardItems(mutate){
  await saveBoardNow();
  const target=board,draft=structuredClone(board),resultId=mutate(draft);
  saving=true;setState('Saving…');
  try{
    const {board:saved}=await request({action:'board_save',input:{board:draft,...(board.id?{base_rev:board.rev}:{})}});
    if(board!==target)throw Error('The board changed while saving. Reopen the saved board to see the result.');
    Object.assign(board,saved);dirty=false;remember();setState('Saved');render();return structuredClone(byId(resultId));
  }catch(error){if(error.status===409){locked=true;setState('Changed elsewhere',true);}else setState('Not saved',true);throw error;}
  finally{saving=false;window.dispatchEvent(new Event('nexus-board:save-settled'));}
}
async function openScene(it){
  const target=board;let sceneItemId=it?.kind==='scene'?it.id:null;
  try{
    const {runSceneEditor}=await import('./board-scene.js?v=20261030-scene1');
    let item=it?.kind==='scene'?structuredClone(it):null;
    if(it?.kind==='image'){
      const {asset}=await request({action:'asset_read',input:{media_id:it.media_id}});
      const {emptyScene,newLayer}=await import('./board-scene-core.js?v=20261030-scene1');
      const scene=emptyScene(),s=Math.min(scene.width*.75/(asset.width||1080),scene.height*.75/(asset.height||1350)),w=(asset.width||1080)*s,h=(asset.height||1350)*s;
      scene.layers.push(newLayer('image',scene,{name:(it.title||'Main subject').slice(0,80),media_id:it.media_id,w,h,x:(scene.width-w)/2,y:(scene.height-h)/2}));
      item={title:(it.title||'Layered scene').slice(0,80),scene};
    }
    runSceneEditor({request,item,boardItems:board.items.map(i=>({...i})),onUpload:uploadFile,
      onSave:async scene=>{
        if(board!==target)throw Error('The board changed. Reopen the correct board before saving.');
        if(!sceneItemId)sceneItemId=newId();
        return commitSceneBoardItems(draft=>{
          let record=draft.items.find(i=>i.id===sceneItemId);
          if(record)record.scene=scene;
          else{
            if(draft.items.length>=LIMITS.items)throw Error('This board is full.');
            const box=fitBox(scene.width,scene.height,340),c=center();
            record={id:sceneItemId,kind:'scene',scene,title:item?.title||'Layered scene',...box,x:it?it.x+it.w+24:Math.round(c.x-box.w/2),y:it?it.y:Math.round(c.y-box.h/2),z:maxZ()+1};draft.items.push(record);
          }
          return record.id;
        });
      },
      onExport:async asset=>{
        if(board!==target)throw Error('Your PNG is in the library; reopen the correct board to add it.');
        return commitSceneBoardItems(draft=>{
          if(draft.items.length>=LIMITS.items)throw Error('PNG is saved in the library. This board is full.');
          const box=fitBox(asset.width,asset.height,340),c=center(),id=newId();
          draft.items.push({id,kind:'image',media_id:asset.media_id,title:asset.name.slice(0,80),...box,x:Math.round(c.x-box.w/2),y:Math.round(c.y-box.h/2),z:maxZ()+1});return id;
        });
      }});
  }catch(e){toast(e.message||'Could not open scene composer.',true);}
}
// Only an explicitly linked, currently interactive control tile can operate its scene.
// The bridge permits transport only: no network calls, scene writes or arbitrary tools.
window.addEventListener('message',event=>{
  const message=event.data;if(!message||message.type!=='nexus-scene-control'||!board)return;
  const tool=board.items.find(i=>i.kind==='visual'&&i.scene_target_id&&i.id===liveId&&els.get(i.id)?.querySelector('iframe')?.contentWindow===event.source);
  if(!tool||message.target_id!==tool.scene_target_id)return;
  const target=board.items.find(i=>i.id===tool.scene_target_id&&i.kind==='scene'),player=target&&scenePlayers.get(target.id);if(!player)return;
  if(message.command==='play')player.play();else if(message.command==='pause')player.pause();
  else if(message.command==='seek'&&Number.isFinite(message.time)&&message.time>=0&&message.time<=target.scene.duration)player.seek(message.time);
});
function looksSheet(){
  const row=h('div',{class:'row'}),sw=h('div',{class:'row'});
  for(const [id,label] of LOOKS)row.append(btn(label,()=>{board.look=id;render();touch();},'big',board.look===id));
  for(const c of SWATCHES){const b=h('button',{type:'button',class:'big','aria-label':`Background ${c}`,style:`background:${c};width:48px;min-height:48px;padding:0;border-radius:50%`});b.onclick=()=>{board.bg=c;render();touch();};sw.append(b);}
  sw.append(btn('Default',()=>{board.bg='';render();touch();},'big'));
  sheet('Look','Make the board look like whatever you are making.',row,h('p',{class:'sub',text:'Background color'}),sw);
}
async function boardsSheet(){
  await flush();const list=h('div',{class:'row col'}),msg=h('p',{class:'sub',text:'Loading boards…'});
  sheet('Boards','',msg,list,h('div',{class:'row'},btn('New board',()=>{closeSheet();openBoard(null);},'big gold')));
  try{const {boards}=await request({action:'board_list',input:{}});msg.textContent=boards.length?'':'No saved boards yet.';
    for(const b of boards){const t=h('button',{type:'button',class:'big'},b.name+(b.id===board.id?'  ·  open':''),h('small',{text:`${b.items} item${b.items===1?'':'s'}`}));t.onclick=()=>{closeSheet();openBoard(b.id);};list.append(t);}
    list.append(btn('Rename this board',()=>{closeSheet();renameBoard();},'big'));
    if(board.id)list.append(btn('Delete this board',()=>{const sure=h('button',{class:'big warn',type:'button',text:'Tap again to delete this board for good'});sure.onclick=async()=>{try{await request({action:'board_delete',input:{id:board.id}});try{localStorage.removeItem('nexus-board-last');}catch{}closeSheet();openBoard(null);}catch(e){toast(e.message,true);}};list.append(sure);},'big warn'));
  }catch(e){msg.textContent=e.message;msg.className='err';}
}
function conflictSheet(message){const s=sheet('Changed somewhere else',message||'A newer version of this board was saved.');s.append(h('div',{class:'row'},btn('Reload the newer board',()=>location.reload(),'big gold')));}

// ---- drawing -----------------------------------------------------------------
function setMode(m){mode=m;drawItemId=null;if(m==='draw'){selId=null;liveId=null;}render();}
function drawBar(){
  drawbar.replaceChildren(...INK.map(c=>{const b=h('button',{type:'button',class:'sw','aria-label':`Ink ${c}`,'aria-pressed':String(ink.c===c),style:`background:${c}`});b.onclick=()=>{ink.c=c;drawBar();};return b;}),
    ...[['S',3],['M',6],['L',14]].map(([l,s])=>{const b=h('button',{type:'button',class:'sz',text:l,'aria-pressed':String(ink.s===s),'aria-label':`Brush ${l}`});b.onclick=()=>{ink.s=s;drawBar();};return b;}),
    btn('Undo',()=>{const it=byId(drawItemId)||[...board.items].reverse().find(i=>i.kind==='sketch');if(it?.strokes.length){it.strokes.pop();render();touch();}}),btn('Done',()=>setMode('select')));
}
const totalPoints=()=>board.items.reduce((n,i)=>i.kind==='sketch'?n+i.strokes.reduce((m,s)=>m+s.p.length,0):n,0);
function startStroke(e){
  const p=screenToWorld(board.view,{x:e.clientX,y:e.clientY});let it=byId(drawItemId);
  if(!it||!inRect(p,it)||it.strokes.length>=LIMITS.strokes){
    if(board.items.length>=LIMITS.items){toast('This board is full.',true);return;}
    const tl=screenToWorld(board.view,{x:0,y:0}),w=Math.min(6000,Math.ceil(innerWidth/board.view.z)),hh=Math.min(6000,Math.ceil(innerHeight/board.view.z));
    it={id:newId(),title:'',kind:'sketch',x:Math.round(tl.x),y:Math.round(tl.y),w,h:hh,z:maxZ()+1,strokes:[]};board.items.push(it);drawItemId=it.id;
  }
  if(totalPoints()>=LIMITS.points){toast('This board has a lot of drawing already. Start a new board for more.',true);return;}
  const st={c:ink.c,s:clamp(Math.round(ink.s/board.view.z*10)/10,1,60),p:[[Math.round((p.x-it.x)*10)/10,Math.round((p.y-it.y)*10)/10]]};it.strokes.push(st);gesture={type:'draw',id:it.id,st};render();
}
function continueStroke(e){
  const it=byId(gesture.id);if(!it)return;let st=gesture.st;const p=screenToWorld(board.view,{x:e.clientX,y:e.clientY}),rel=[p.x-it.x,p.y-it.y];
  if(totalPoints()>=LIMITS.points)return;
  if(st.p.length>=LIMITS.pointsPerStroke){if(it.strokes.length>=LIMITS.strokes)return;const last=st.p[st.p.length-1];st={c:st.c,s:st.s,p:[last.slice()]};it.strokes.push(st);gesture.st=st;}
  if(addPoint(st.p,[clamp(rel[0],0,it.w),clamp(rel[1],0,it.h)],Math.max(1,2/board.view.z)))updateEl(els.get(it.id),it);
}

// ---- gestures ----------------------------------------------------------------
const mid=()=>{const [a,b]=[...ptrs.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)||1};};
viewport.addEventListener('pointerdown',e=>{
  if(!board)return;viewport.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2){if(gesture?.type==='draw'){gesture=null;}const m=mid();gesture={type:'pinch',m0:m,view0:{...board.view}};return;}
  if(ptrs.size>2)return;
  const sx=e.clientX,sy=e.clientY;
  if(mode==='draw'){startStroke(e);return;}
  if(e.target.closest('.handle')&&selId){const it=byId(selId);gesture={type:'resize',id:it.id,sx,sy,ow:it.w,oh:it.h,moved:false};return;}
  const itemEl=e.target.closest('.bitem');
  if(itemEl){const it=byId(itemEl.dataset.id);choose(it.id);gesture={type:'move',id:it.id,sx,sy,ox:it.x,oy:it.y,moved:false};return;}
  gesture={type:'pan',sx,sy,ox:board.view.x,oy:board.view.y,moved:false};
});
viewport.addEventListener('pointermove',e=>{
  if(!ptrs.has(e.pointerId)||!gesture)return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});const z=board.view.z;
  if(gesture.type==='pinch'&&ptrs.size===2){const m=mid(),g=gesture,w=screenToWorld(g.view0,g.m0),nz=clamp(g.view0.z*m.d/g.m0.d,ZOOM_MIN,ZOOM_MAX);board.view={x:m.x-w.x*nz,y:m.y-w.y*nz,z:nz};applyView();return;}
  if(ptrs.size!==1)return;
  if(gesture.type==='draw'){continueStroke(e);return;}
  const dx=e.clientX-gesture.sx,dy=e.clientY-gesture.sy;if(Math.hypot(dx,dy)>6)gesture.moved=true;if(!gesture.moved)return;
  if(gesture.type==='pan'){board.view.x=gesture.ox+dx;board.view.y=gesture.oy+dy;applyView();}
  else if(gesture.type==='move'){const it=byId(gesture.id);it.x=Math.round(gesture.ox+dx/z);it.y=Math.round(gesture.oy+dy/z);updateEl(els.get(it.id),it);}
  else if(gesture.type==='resize'){const it=byId(gesture.id);it.w=clamp(Math.round(gesture.ow+dx/z),40,6000);it.h=clamp(Math.round(gesture.oh+dy/z),40,6000);updateEl(els.get(it.id),it);}
});
function endPointer(e){
  ptrs.delete(e.pointerId);const g=gesture;
  if(ptrs.size===1&&g?.type==='pinch'){const [only]=ptrs.values();gesture={type:'pan',sx:only.x,sy:only.y,ox:board.view.x,oy:board.view.y,moved:true};touch();return;}
  if(ptrs.size>0)return;gesture=null;if(!g)return;
  if(g.type==='pan'){if(g.moved)touch();else if(selId){selId=null;liveId=null;render();}}
  else if(g.type==='move'||g.type==='resize'){if(g.moved){render();touch();}}
  else if(g.type==='draw'){render();touch();}
  else if(g.type==='pinch')touch();
}
viewport.addEventListener('pointerup',endPointer);viewport.addEventListener('pointercancel',endPointer);
viewport.addEventListener('wheel',e=>{if(!board)return;e.preventDefault();board.view=zoomAt(board.view,{x:e.clientX,y:e.clientY},Math.exp(-e.deltaY*0.0015));applyView();clearTimeout(viewport._w);viewport._w=setTimeout(touch,600);},{passive:false});

// ---- boards ------------------------------------------------------------------
function blank(){return {name:'New board',look:'dots',bg:'',view:{x:innerWidth/2-140,y:innerHeight/2-120,z:1},items:[],rev:0};}
async function openBoard(id){
  await flush();scenePlayers.forEach(p=>p.dispose());scenePlayers.clear();els.forEach(e=>e.remove());els.clear();selId=liveId=null;mode='select';locked=false;dirty=false;
  if(id){try{board=(await request({action:'board_read',input:{id}})).board;}catch(e){toast(e.message,true);board=blank();}}else board=blank();
  if(board.id){remember();try{history.replaceState(null,'',`?id=${encodeURIComponent(board.id)}`);}catch{}}else{try{history.replaceState(null,'',location.pathname);}catch{}}
  render();setState(board.id?'Saved':'');
}
$('addBtn').onclick=addSheet;$('lookBtn').onclick=looksSheet;$('boardsBtn').onclick=boardsSheet;
$('drawBtn').onclick=()=>setMode(mode==='draw'?'select':'draw');
$('fitBtn').onclick=()=>{board.view=fitView(board.items,{w:innerWidth,h:innerHeight});render();touch();};
function renameBoard(){nameInput.focus();nameInput.select();}
$('renameBtn').onclick=renameBoard;
nameInput.addEventListener('input',()=>{board.name=nameInput.value.slice(0,80)||'Board';touch();});
nameInput.addEventListener('blur',()=>{nameInput.value=board.name;});
nameInput.addEventListener('keydown',e=>{if(e.key==='Enter')nameInput.blur();});
addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&selId&&!/INPUT|TEXTAREA/.test(document.activeElement?.tagName||'')){removeItem(selId);}});

// Plug-in point for workflows: register extra actions that appear in the selected-item bar.
const api={
  get board(){return structuredClone(board);},get selected(){const it=selId&&byId(selId);return it?structuredClone(it):null;},
  addItem:p=>addItem(p),updateItem,removeItem,toast,request,
  registerAction(a){if(!a||typeof a.run!=='function'||typeof a.label!=='string')throw Error('An action needs a label and a run function.');hooks.push(a);render();}
};
window.nexusBoard=api;

(async function boot(){
  try{
    const id=lastId();let opened=false;
    if(id){try{await openBoard(id);opened=true;}catch{}}
    if(!opened){const {boards}=await request({action:'board_list',input:{}});if(boards.length&&!new URLSearchParams(location.search).has('new'))await openBoard(boards[0].id);else await openBoard(null);}
  }catch(e){
    board=blank();render();
    if(e.status===401){emptyNote.hidden=false;emptyNote.replaceChildren('Sign in to your Nexus owner account to use the Board.',h('br'),h('a',{href:'/workspace.html',text:'Open Nexus',style:'color:#e8c36a'}));locked=true;setState('Signed out',true);}
    else{toast(e.message,true);setState('Offline',true);}
  }
})();
