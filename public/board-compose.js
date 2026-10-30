import {loadOriginal} from './nexus-lab-cutout.js';
import {outputSize,paintComposition} from './board-compose-core.js?v=20261030-compose1';
import {rasterizeVisual,TRIPPY_VISUAL} from './board-background.js?v=20261030-sources1';

const element=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(text,run)=>{const b=element('button',text);b.type='button';b.onclick=run;return b;};
const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not export this image.')),'image/png'));
const hex=buf=>Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
export async function savePngAsset({request,blob,width,height,name,provenance}){
  const bytes=await blob.arrayBuffer(),sha256=hex(await crypto.subtle.digest('SHA-256',bytes));
  const {limits}=await request({action:'asset_list',input:{}});
  const {asset}=await request({action:'asset_begin',request_id:crypto.randomUUID(),input:{
    name:((name||'Board artwork').slice(0,65)+'.png'),kind:'image',bytes:bytes.byteLength,sha256,width,height,provenance}});
  for(let i=0;i<asset.chunks;i++){
    const part=new Uint8Array(bytes,i*limits.chunkBytes,Math.min(limits.chunkBytes,bytes.byteLength-i*limits.chunkBytes));
    await request({action:'asset_chunk',input:{media_id:asset.media_id,index:i,data_base64:encode(part)}});
  }
  return (await request({action:'asset_finish',input:{media_id:asset.media_id}})).asset;
}
export function saveComposition({request,blob,foregroundId,backgroundId,width,height,placement,format,name,attribution=''}){
  return savePngAsset({request,blob,width,height,name,provenance:{role:'output',origin:'derived',
    parent_ids:[...new Set([foregroundId,backgroundId])],attribution:attribution.slice(0,500),
    notes:JSON.stringify({tool:'board-compose',version:2,foreground:foregroundId,background:backgroundId,format,placement})}});
}
export function runComposer({request,item,boardItems=[],onUpload,onSaved}){
  let fg=null,bg=null,disposed=false,saving=false,saved=false,savedAsset=null,backgroundLoad=0,downloadUrl=null,busy=false;
  const host=element('section');host.className='composer';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','Compose background');
  const top=element('div'),heading=element('h2','Compose background'),close=button('Close',dispose);top.className='compose-top';top.append(heading,close);
  const body=element('div');body.className='compose-body';
  const instructions=element('p','Build a still image from your cutout and a background. Drag the foreground or use the sliders. Backgrounds fill the frame and may be cropped.');
  const status=element('p','Loading your foreground and image library…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const attributionLabel=element('p');attributionLabel.className='compose-credit';
  const frame=element('div');frame.className='compose-frame';
  const canvas=element('canvas');canvas.setAttribute('aria-label','Composition preview');canvas.width=480;canvas.height=320;frame.append(canvas);
  const editing=element('fieldset');editing.className='compose-editing';
  const name=element('input');name.type='text';name.maxLength=65;name.value=(item.title||'Image').slice(0,45)+' composition';name.setAttribute('aria-label','Composition name');
  const source=element('select');source.setAttribute('aria-label','Background source');
  for(const [value,label] of [['library','Saved images'],['board','This board'],['lookup','Image lookup'],['visual','Custom HTML / SVG'],['upload','Upload image']])source.append(new Option(label,value));
  const picker=element('select');picker.id='compose-background';picker.setAttribute('aria-label','Background image');picker.append(new Option('Choose a background image',''));
  const boardPicker=element('select');boardPicker.setAttribute('aria-label','Board background');boardPicker.append(new Option('Choose a board item',''));
  for(const it of boardItems.filter(i=>i.id!==item.id&&['image','visual'].includes(i.kind)))boardPicker.append(new Option((it.title||'Untitled')+(it.kind==='visual'?' · visual':''),it.id));
  const visualPanel=element('div'),code=element('textarea');code.setAttribute('aria-label','Background artwork');code.placeholder='Paste self-contained HTML or SVG';code.maxLength=60000;code.rows=7;
  const visualHelp=element('p','Still artwork: HTML, CSS and SVG. Scripts, canvas drawings, video and external images are not captured. Use embedded images. To keep motion, use an Inline visual on the board.');
  const dims=element('div');dims.className='compose-dimensions';
  const width=dimension('Artwork width',1080),height=dimension('Artwork height',1350);
  function dimension(label,value){const wrap=element('label',label),input=element('input');input.type='number';input.min=1;input.max=4096;input.value=value;input.setAttribute('aria-label',label);wrap.append(input);dims.append(wrap);return input;}
  const sample=button('Try trippy rings',()=>{code.value=TRIPPY_VISUAL;});
  const capture=button('Use artwork',()=>choose(async()=>createArtwork(code.value,Number(width.value),Number(height.value))));
  visualPanel.append(visualHelp,code,dims,sample,capture);
  const lookup=element('div'),query=element('input');query.type='text';query.maxLength=120;query.setAttribute('aria-label','Image search');query.placeholder='Neon tunnel, desert sunset…';
  const results=element('div');results.className='compose-results';
  let searchGeneration=0;
  const search=button('Find images',async()=>{
    const q=query.value.trim();if(q.length<2){status.textContent='Describe the image in at least two characters.';return;}
    const generation=++searchGeneration;search.disabled=true;results.replaceChildren();status.textContent='Finding images…';
    try{const found=await request({action:'background_search',input:{query:q}});
      if(disposed||generation!==searchGeneration)return;
      for(const candidate of found.candidates||[]){
        const card=element('div');card.className='compose-result';
        const picture=element('img');picture.loading='lazy';picture.referrerPolicy='no-referrer';picture.alt=candidate.title||'Stock image';
        if(/^https:\/\//i.test(candidate.thumb_url||''))picture.src=candidate.thumb_url;
        const title=element('p',candidate.title||'Stock image'),credit=element('small',candidate.credit||candidate.creator||candidate.source);
        const use=button('Use image',()=>choose(async()=>{
          const {asset}=await request({action:'background_import',request_id:crypto.randomUUID(),input:{candidate_id:candidate.id}});
          addLibraryOption(asset);return loadOriginal(request,asset.media_id);
        }));
        card.append(picture,title,credit,use);results.append(card);
      }
      const warnings=(found.skipped||[]).map(s=>typeof s==='string'?s:(s.source?s.source+' is unavailable.':'One image library is unavailable.')).join(' ');
      status.textContent=(results.childElementCount?'Choose an image below.':'No images found. Try another description.')+(warnings?' '+warnings:'');
    }catch(e){if(!disposed&&generation===searchGeneration)status.textContent=e.message||'Image search failed.';}
    finally{if(!disposed&&generation===searchGeneration)search.disabled=false;}
  });
  query.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();search.click();}};lookup.append(query,search,results);
  const upload=button('Choose image file',()=>{
    const input=element('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';
    input.onchange=()=>{const file=input.files?.[0];if(file)choose(async()=>{if(!onUpload)throw Error('Image upload is unavailable.');const asset=await onUpload(file);addLibraryOption(asset);return loadOriginal(request,asset.media_id);});};
    input.click();
  });
  const panels={library:picker,board:boardPicker,lookup,visual:visualPanel,upload};
  const format=element('select');format.setAttribute('aria-label','Output format');
  for(const [value,label] of [['background','Background proportions'],['portrait','Portrait 9:16'],['square','Square 1:1'],['landscape','Landscape 16:9']])format.append(new Option(label,value));
  editing.append(name,source,...Object.values(panels),format);
  const controls=element('div');controls.className='compose-controls';
  const placement={x:.5,y:.5,scale:.85},sliders={};
  function slider(label,key,min,max,step){
    const wrap=element('label',label),input=element('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=placement[key];input.setAttribute('aria-label',label);
    input.oninput=()=>{placement[key]=Number(input.value);invalidate();draw();};wrap.append(input);sliders[key]=input;controls.append(wrap);
  }
  slider('Horizontal position','x',-.5,1.5,.01);slider('Vertical position','y',-.5,1.5,.01);slider('Foreground size','scale',.1,3,.01);
  const reset=button('Reset position',()=>{Object.assign(placement,{x:.5,y:.5,scale:.85});invalidate();sync();draw();});
  const download=button('Download PNG',async()=>{
    try{download.disabled=true;const blob=await exportBlob();if(disposed)return;
      if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(blob);
      const a=element('a');a.href=downloadUrl;a.download=(name.value.trim()||'Board composition')+'.png';a.click();
      status.textContent='PNG download requested. Save to library to keep it on your board.';
    }catch(e){status.textContent=e.message||'Could not download.';}finally{if(!disposed)download.disabled=!ready();}
  });
  const save=button('Save to library',async()=>{
    if(saving||saved||!ready())return;
    saving=true;editing.disabled=true;close.disabled=true;reset.disabled=true;for(const input of Object.values(sliders))input.disabled=true;draw();status.textContent='Saving composition…';
    try{
      const blob=await exportBlob();
      const attribution=[fg.asset,bg.asset].map(a=>a.provenance?.attribution||a.description||'').filter(Boolean).join(' | ');
      if(!savedAsset)savedAsset=await saveComposition({request,blob,foregroundId:item.media_id,backgroundId:bg.asset.media_id,width:canvas.width,height:canvas.height,placement:{...placement},format:format.value,name:name.value.trim(),attribution});
      savedAsset.name=(name.value.trim()||'Board composition');
      await onSaved(savedAsset);saved=true;status.textContent='Saved to your library and added to the board. Originals are unchanged.';
    }catch(e){status.textContent=e.message||'Could not save. Try again.';}
    finally{saving=false;close.disabled=false;if(!savedAsset){editing.disabled=false;reset.disabled=false;for(const input of Object.values(sliders))input.disabled=false;}draw();}
  });
  const actions=element('div');actions.className='compose-actions';save.className='gold';actions.append(reset,download,save);
  body.append(instructions,status,editing,frame,attributionLabel,controls,actions);host.append(top,body);document.body.append(host);
  const previousFocus=document.activeElement;close.focus();
  function ready(){return !!fg&&!!bg&&!disposed&&!busy;}
  function invalidate(){savedAsset=null;saved=false;save.textContent='Save to library';}
  function sync(){for(const [key,input] of Object.entries(sliders))input.value=placement[key];}
  function dimensions(){if(format.value==='portrait')return {width:1080,height:1920};if(format.value==='square')return {width:1080,height:1080};if(format.value==='landscape')return {width:1920,height:1080};return outputSize(bg.bitmap.width,bg.bitmap.height);}
  function draw(){attributionLabel.textContent=bg?(bg.asset.provenance?.attribution||bg.asset.description||''):'';download.disabled=!ready()||saving;save.disabled=!ready()||saving||saved;save.textContent=saved?'Saved to library':'Save to library';
    if(!ready()){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);return;}const size=dimensions();canvas.width=size.width;canvas.height=size.height;paintComposition(canvas,bg.bitmap,fg.bitmap,placement);
  }
  async function exportBlob(){if(!ready())throw Error('Choose a background image first.');draw();return png(canvas);}
  function dispose(){if(saving)return;disposed=true;backgroundLoad++;searchGeneration++;fg?.bitmap.close?.();bg?.bitmap.close?.();if(downloadUrl)URL.revokeObjectURL(downloadUrl);host.remove();previousFocus?.focus?.();}
  async function choose(load){
    if(saving||savedAsset)return;
    const generation=++backgroundLoad;busy=true;bg?.bitmap.close?.();bg=null;invalidate();draw();status.textContent='Preparing background…';
    try{const loaded=await load();if(disposed||generation!==backgroundLoad){loaded.bitmap.close?.();return;}bg=loaded;busy=false;draw();status.textContent=canvas.width+' × '+canvas.height+' PNG. Drag the foreground to position it.';}
    catch(e){if(!disposed&&generation===backgroundLoad){busy=false;draw();status.textContent=e.message||'Could not load background.';}}
  }
  async function createArtwork(html,w,h){
    const art=await rasterizeVisual(html,w,h);if(disposed)throw Error('Composer closed.');
    const asset=await savePngAsset({request,...art,name:'Custom background',provenance:{role:'original',origin:'generated',notes:'Static HTML/SVG artwork captured on the visual board.'}});
    addLibraryOption(asset);return loadOriginal(request,asset.media_id);
  }
  function addLibraryOption(asset){if(disposed)return;if(![...picker.options].some(o=>o.value===asset.media_id))picker.append(new Option(asset.name,asset.media_id));}
  picker.onchange=()=>{if(picker.value)choose(()=>loadOriginal(request,picker.value));else clearBackground();};
  boardPicker.onchange=()=>{
    const selected=boardItems.find(i=>i.id===boardPicker.value);if(!selected){clearBackground();return;}
    choose(()=>selected.kind==='image'?loadOriginal(request,selected.media_id):createArtwork(selected.html,selected.w,selected.h));
  };
  function clearBackground(){backgroundLoad++;busy=false;bg?.bitmap.close?.();bg=null;invalidate();draw();status.textContent='Choose a background image.';}
  source.onchange=()=>{clearBackground();for(const [key,panel] of Object.entries(panels))panel.hidden=key!==source.value;picker.value='';boardPicker.value='';searchGeneration++;search.disabled=false;};
  for(const [key,panel] of Object.entries(panels))panel.hidden=key!==source.value;
  format.onchange=()=>{invalidate();draw();if(ready())status.textContent=canvas.width+' × '+canvas.height+' PNG.';};
  let drag=null;
  canvas.onpointerdown=e=>{if(!ready()||saving||savedAsset)return;canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:placement.x,py:placement.y};e.preventDefault();};
  canvas.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;const rect=canvas.getBoundingClientRect();placement.x=Math.max(-.5,Math.min(1.5,drag.px+(e.clientX-drag.x)/rect.width));placement.y=Math.max(-.5,Math.min(1.5,drag.py+(e.clientY-drag.y)/rect.height));invalidate();sync();draw();};
  canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
  host.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();dispose();}if(e.key==='Tab'){const focusable=[...host.querySelectorAll('button,input,select,textarea')].filter(n=>!n.matches(':disabled')&&n.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  draw();
  (async()=>{try{const foreground=await loadOriginal(request,item.media_id);if(disposed){foreground.bitmap.close?.();return;}fg=foreground;
    const {media}=await request({action:'asset_list',input:{}});if(disposed)return;
    const images=media.filter(m=>m.kind==='image'&&m.status==='ready'&&m.media_id!==item.media_id);
    for(const image of images)addLibraryOption(image);
    status.textContent=images.length?'Choose a background image.':'No other images yet. Choose Image lookup, Custom HTML / SVG, This board or Upload image.';
    draw();
  }catch(e){if(!disposed)status.textContent=e.message||'Could not load the composer.';}})();
  return host;
}
