import {rasterizeVisual,TRIPPY_VISUAL} from './board-background.js?v=20261030-sources1';
import {savePngAsset} from './board-compose.js?v=20261030-sources1';
export const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export const btn=(label,run)=>{const b=el('button',label);b.type='button';b.onclick=run;return b;};
export function openSceneSources(host,{request,onUpload,boardItems=[],onAdd,onClose=()=>{}}){
  let alive=true;const pane=el('section');pane.className='scene-source';pane.setAttribute('aria-label','Add image layer');pane.setAttribute('role','dialog');pane.setAttribute('aria-modal','true');const previousFocus=document.activeElement;
  const status=el('p','Loading saved images…');status.setAttribute('role','status');
  const source=el('select');source.setAttribute('aria-label','Layer source');
  for(const [v,t] of [['library','Saved images'],['board','This board'],['search','Image lookup'],['visual','Custom HTML / SVG'],['upload','Upload image']])source.append(new Option(t,v));
  const library=el('select');library.setAttribute('aria-label','Saved layer image');library.append(new Option('Choose an image',''));
  const board=el('select');board.setAttribute('aria-label','Board layer source');board.append(new Option('Choose a board picture or visual',''));
  for(const i of boardItems.filter(i=>['image','visual'].includes(i.kind)))board.append(new Option(i.title||'Untitled '+i.kind,i.id));
  const searchPanel=el('div'),query=el('input'),results=el('div');query.type='text';query.maxLength=120;query.placeholder='Park, bird, dog…';query.setAttribute('aria-label','Layer image search');results.className='compose-results';
  const search=btn('Find images',async()=>{
    if(query.value.trim().length<2){status.textContent='Describe the image in at least two characters.';return;}
    search.disabled=true;status.textContent='Finding images…';results.replaceChildren();
    try{const found=await request({action:'background_search',input:{query:query.value.trim()}});
      if(!alive)return;
      for(const c of found.candidates||[]){
        const card=el('div');card.className='compose-result';const img=el('img');img.alt=c.title||'Stock picture';img.referrerPolicy='no-referrer';img.loading='lazy';if(/^https:\/\//.test(c.thumb_url||''))img.src=c.thumb_url;
        const use=btn('Add image',()=>work(async()=>{const {asset}=await request({action:'background_import',request_id:crypto.randomUUID(),input:{candidate_id:c.id}});return asset;}));
        card.append(img,el('p',c.title||'Stock picture'),el('small',c.credit||''),use);results.append(card);
      }
      status.textContent=found.candidates?.length?'Choose a picture. Use Cut out on a layer to remove its background.':'No pictures found. Try another description.';
    }catch(e){if(alive)status.textContent=e.message;}finally{if(alive)search.disabled=false;}
  });
  query.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();search.click();}};searchPanel.append(query,search,results);
  const visual=el('div'),code=el('textarea');code.rows=5;code.maxLength=60000;code.setAttribute('aria-label','Layer artwork');code.placeholder='Self-contained HTML or SVG';
  visual.append(el('p','Captures still HTML/CSS/SVG artwork. Scripts and external resources are not captured. Animate the resulting layer with Motion.'),code,btn('Try trippy rings',()=>{code.value=TRIPPY_VISUAL;}),btn('Add artwork',()=>work(async()=>{
    const image=await rasterizeVisual(code.value,1080,1350);
    return savePngAsset({request,...image,name:'Scene artwork',provenance:{role:'original',origin:'generated',notes:'Static artwork for an editable scene layer.'}});
  })));
  const upload=btn('Choose image file',()=>{const input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.onchange=()=>{if(input.files?.[0])work(()=>onUpload(input.files[0]));};input.click();});
  const panels={library,board,search:searchPanel,visual,upload};
  source.onchange=()=>{for(const [key,n] of Object.entries(panels))n.hidden=key!==source.value;status.textContent='Choose an image to add as a new layer.';};
  source.onchange();
  const close=btn('Cancel add layer',dispose);
  pane.append(el('h3','Add image layer'),close,source,...Object.values(panels),status);host.append(pane);close.focus();
  pane.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();dispose();}if(e.key==='Tab'){e.stopPropagation();const nodes=[...pane.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  const assets=new Map();
  async function work(make){
    if(!alive)return;const controls=[...pane.querySelectorAll('button,select,input,textarea')];controls.forEach(n=>{if(n!==close)n.disabled=true;});status.textContent='Preparing image layer…';
    try{const asset=await make();if(!alive)return;await onAdd(asset);dispose();}
    catch(e){if(alive){status.textContent=e.message||'Could not add this layer.';controls.forEach(n=>n.disabled=false);}}
  }
  library.onchange=()=>{const asset=assets.get(library.value);if(asset)work(async()=>asset);};
  board.onchange=()=>{const item=boardItems.find(i=>i.id===board.value);if(!item)return;work(async()=>{
    if(item.kind==='image')return (await request({action:'asset_read',input:{media_id:item.media_id}})).asset;
    const image=await rasterizeVisual(item.html,Math.max(40,Math.round(item.w)),Math.max(40,Math.round(item.h)));
    return savePngAsset({request,...image,name:item.title||'Board artwork',provenance:{role:'original',origin:'generated',notes:'Still captured from a board visual for scene animation.'}});
  });};
  (async()=>{try{const {media}=await request({action:'asset_list',input:{}});if(!alive)return;for(const a of media.filter(a=>a.kind==='image'&&a.status==='ready')){assets.set(a.media_id,a);library.append(new Option(a.name,a.media_id));}status.textContent=assets.size?'Choose an image or another source.':'No images yet. Use Image lookup, Custom HTML / SVG or Upload image.';}catch(e){if(alive)status.textContent=e.message;}})();
  function dispose(){if(!alive)return;alive=false;pane.remove();onClose();previousFocus?.focus?.();}
  return {dispose};
}
