import {loadOriginal} from './nexus-lab-cutout.js';
import {outputSize,paintComposition} from './board-compose-core.js?v=20261030-compose1';

const element=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(text,run)=>{const b=element('button',text);b.type='button';b.onclick=run;return b;};
const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not export this image.')),'image/png'));
const hex=buf=>Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
export async function saveComposition({request,blob,foregroundId,backgroundId,width,height,placement,format,name}){
  const bytes=await blob.arrayBuffer(),sha256=hex(await crypto.subtle.digest('SHA-256',bytes));
  const {limits}=await request({action:'asset_list',input:{}});
  const {asset}=await request({action:'asset_begin',request_id:crypto.randomUUID(),input:{
    name:((name||'Board composition').slice(0,65)+'.png'),kind:'image',bytes:bytes.byteLength,sha256,width,height,
    provenance:{role:'output',origin:'derived',parent_ids:[...new Set([foregroundId,backgroundId])],
      notes:JSON.stringify({tool:'board-compose',version:1,foreground:foregroundId,background:backgroundId,format,placement})}}});
  for(let i=0;i<asset.chunks;i++){
    const part=new Uint8Array(bytes,i*limits.chunkBytes,Math.min(limits.chunkBytes,bytes.byteLength-i*limits.chunkBytes));
    await request({action:'asset_chunk',input:{media_id:asset.media_id,index:i,data_base64:encode(part)}});
  }
  return (await request({action:'asset_finish',input:{media_id:asset.media_id}})).asset;
}
export function runComposer({request,item,onSaved}){
  const host=element('section');host.className='composer';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','Compose background');
  const top=element('div'),heading=element('h2','Compose background'),close=button('Close',dispose);top.className='compose-top';top.append(heading,close);
  const body=element('div');body.className='compose-body';
  const instructions=element('p','Choose a background, then drag the foreground or use the position and size sliders. Transparent cutouts work best. Backgrounds fill the frame and may be cropped.');
  const status=element('p','Loading your foreground and image library…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const frame=element('div');frame.className='compose-frame';
  const canvas=element('canvas');canvas.setAttribute('aria-label','Composition preview');canvas.width=480;canvas.height=320;frame.append(canvas);
  const picker=element('select');picker.id='compose-background';picker.setAttribute('aria-label','Background image');
  picker.append(new Option('Choose a background image',''));
  const format=element('select');format.setAttribute('aria-label','Output format');
  for(const [value,label] of [['background','Background proportions'],['portrait','Portrait 9:16'],['square','Square 1:1'],['landscape','Landscape 16:9']])format.append(new Option(label,value));
  const name=element('input');name.type='text';name.maxLength=65;name.value=(item.title||'Image').slice(0,45)+' composition';name.setAttribute('aria-label','Composition name');
  const controls=element('div');controls.className='compose-controls';
  const placement={x:.5,y:.5,scale:.85};const sliders={};
  function slider(label,key,min,max,step){
    const wrap=element('label',label),input=element('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=placement[key];input.setAttribute('aria-label',label);
    input.oninput=()=>{placement[key]=Number(input.value);draw();};wrap.append(input);sliders[key]=input;controls.append(wrap);
  }
  slider('Horizontal position','x',-.5,1.5,.01);slider('Vertical position','y',-.5,1.5,.01);slider('Foreground size','scale',.1,3,.01);
  const reset=button('Reset position',()=>{Object.assign(placement,{x:.5,y:.5,scale:.85});sync();draw();});
  const download=button('Download PNG',async()=>{
    try{download.disabled=true;const blob=await exportBlob();if(disposed)return;
      if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(blob);
      const a=element('a');a.href=downloadUrl;a.download=(name.value.trim()||'Board composition')+'.png';a.click();
      status.textContent='PNG download requested. Save to library to keep it on your board.';
    }catch(e){status.textContent=e.message||'Could not download.';}finally{if(!disposed)download.disabled=!ready();}
  });
  const save=button('Save to library',async()=>{
    if(saving||saved)return;
    saving=true;save.disabled=true;close.disabled=true;name.disabled=true;picker.disabled=format.disabled=true;for(const input of Object.values(sliders))input.disabled=true;reset.disabled=true;status.textContent='Saving composition…';
    try{const blob=await exportBlob();if(!savedAsset)savedAsset=await saveComposition({request,blob,foregroundId:item.media_id,backgroundId:bg.asset.media_id,width:canvas.width,height:canvas.height,placement:{...placement},format:format.value,name:name.value.trim()});
      savedAsset.name=(name.value.trim()||'Board composition'); // Board label only; stored media name remains stable.
      await onSaved(savedAsset);saved=true;status.textContent='Saved to your library and added to the board. Originals are unchanged.';
    }catch(e){status.textContent=e.message||'Could not save. Try again.';}
    finally{saving=false;close.disabled=false;save.disabled=saved||!ready();save.textContent=saved?'Saved to library':'Save to library';if(!savedAsset){name.disabled=false;picker.disabled=format.disabled=false;for(const input of Object.values(sliders))input.disabled=false;reset.disabled=false;}}
  });
  const actions=element('div');actions.className='compose-actions';save.className='gold';actions.append(reset,download,save);
  body.append(instructions,status,name,picker,format,frame,controls,actions);host.append(top,body);document.body.append(host);
  let fg=null,bg=null,disposed=false,saving=false,saved=false,savedAsset=null,backgroundLoad=0,downloadUrl=null;
  const previousFocus=document.activeElement;close.focus();
  function ready(){return !!fg&&!!bg&&!disposed;}
  function sync(){for(const [key,input] of Object.entries(sliders))input.value=placement[key];}
  function dimensions(){if(format.value==='portrait')return {width:1080,height:1920};if(format.value==='square')return {width:1080,height:1080};if(format.value==='landscape')return {width:1920,height:1080};return outputSize(bg.bitmap.width,bg.bitmap.height);}
  function draw(){download.disabled=!ready();save.disabled=!ready()||saving||saved;
    if(!ready())return;const size=dimensions();canvas.width=size.width;canvas.height=size.height;paintComposition(canvas,bg.bitmap,fg.bitmap,placement);
  }
  async function exportBlob(){if(!ready())throw Error('Choose a background image first.');draw();return png(canvas);}
  function dispose(){if(saving)return;disposed=true;backgroundLoad++;fg?.bitmap.close?.();bg?.bitmap.close?.();if(downloadUrl)URL.revokeObjectURL(downloadUrl);host.remove();previousFocus?.focus?.();}
  picker.onchange=async()=>{
    const generation=++backgroundLoad;bg?.bitmap.close?.();bg=null;savedAsset=null;saved=false;save.textContent='Save to library';draw();
    if(!picker.value){status.textContent='Choose a background image.';return;}
    status.textContent='Loading background…';
    try{const loaded=await loadOriginal(request,picker.value);if(disposed||generation!==backgroundLoad){loaded.bitmap.close?.();return;}bg=loaded;draw();status.textContent=canvas.width+' × '+canvas.height+' PNG. Drag the foreground to position it.';}
    catch(e){if(!disposed&&generation===backgroundLoad)status.textContent=e.message||'Could not load background.';}
  };
  format.onchange=()=>{saved=false;savedAsset=null;save.textContent='Save to library';draw();if(ready())status.textContent=canvas.width+' × '+canvas.height+' PNG.';};
  let drag=null;
  canvas.onpointerdown=e=>{if(!ready()||saving||savedAsset)return;canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:placement.x,py:placement.y};e.preventDefault();};
  canvas.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;const rect=canvas.getBoundingClientRect();placement.x=Math.max(-.5,Math.min(1.5,drag.px+(e.clientX-drag.x)/rect.width));placement.y=Math.max(-.5,Math.min(1.5,drag.py+(e.clientY-drag.y)/rect.height));sync();draw();};
  canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
  host.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();dispose();}if(e.key==='Tab'){const focusable=[...host.querySelectorAll('button,input,select')].filter(n=>!n.disabled);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  draw();
  (async()=>{try{const foreground=await loadOriginal(request,item.media_id);if(disposed){foreground.bitmap.close?.();return;}fg=foreground;
    const {media}=await request({action:'asset_list',input:{}});if(disposed)return;
    const images=media.filter(m=>m.kind==='image'&&m.status==='ready'&&m.media_id!==item.media_id);
    for(const image of images)picker.append(new Option(image.name,image.media_id));
    status.textContent=images.length?'Choose a background image.':'No other images yet. Close, add or upload a background image, then reopen Background.';
    draw();
  }catch(e){if(!disposed)status.textContent=e.message||'Could not load the composer.';}})();
  return host;
}
