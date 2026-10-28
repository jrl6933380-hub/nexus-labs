// Refine a connected AI's rough Cutout outline into a pixel-accurate mask, in the browser.
// Nothing leaves the device except the saved result, and nothing is saved until you press Save.
import {segmentSubject,applyMask} from './nexus-lab-segment.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const MAX_PIXELS=2500000; // refine at up to 2.5 megapixels; bigger pictures are scaled down first
const CONFIDENCE={high:'The subject and background colors are clearly different, so the edge should be reliable.',
  medium:'The colors overlap a little, so check the edge before you rely on it.',
  low:'The subject and background look alike, so this edge is a best guess. Treat it as rough.'};

export async function loadOriginal(request,mediaId){
  const {asset}=await request({action:'asset_read',input:{media_id:mediaId}});
  if(asset.kind!=='image'||asset.status!=='ready')throw Error('That is not a finished image in your library.');
  const parts=[];
  for(let i=0;i<asset.chunks;i++){
    const c=await request({action:'asset_download',input:{media_id:mediaId,index:i}});
    if(c.media_id!==mediaId||c.index!==i||c.sha256!==asset.sha256)throw Error('The download does not match the saved asset.');
    parts.push(decode(c.data_base64));
  }
  const bitmap=await createImageBitmap(new Blob(parts,{type:asset.mime}));
  const scale=Math.min(1,Math.sqrt(MAX_PIXELS/(bitmap.width*bitmap.height)));
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);
  return {asset,width,height,pixels:ctx.getImageData(0,0,width,height)};
}
export function cutoutCanvas(pixels,alpha){
  const canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;
  const data=applyMask({data:pixels.data,width:pixels.width,height:pixels.height},alpha);
  canvas.getContext('2d').putImageData(new ImageData(data,pixels.width,pixels.height),0,0);return canvas;
}
export function maskCanvas(alpha,width,height){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const image=new ImageData(width,height);for(let i=0;i<alpha.length;i++){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=alpha[i];image.data[i*4+3]=255;}
  canvas.getContext('2d').putImageData(image,0,0);return canvas;
}
const toPng=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not make a PNG.')),'image/png'));

// Saves a derived picture into the shared media library, linked to its original.
export async function saveDerived({request,parentId,blob,name,role,notes,width,height}){
  const bytes=await blob.arrayBuffer(),checksum=await sha(bytes);
  const {limits}=await request({action:'asset_list',input:{}});
  const begin=await request({action:'asset_begin',request_id:crypto.randomUUID(),input:{name:name.slice(0,80),kind:'image',bytes:bytes.byteLength,sha256:checksum,width,height,
    provenance:{role,origin:'derived',parent_ids:[parentId],notes}}});
  const asset=begin.asset,size=limits.chunkBytes;
  for(let i=0;i<asset.chunks;i++){
    const part=new Uint8Array(bytes,i*size,Math.min(size,bytes.byteLength-i*size));
    await request({action:'asset_chunk',input:{media_id:asset.media_id,index:i,data_base64:encode(part)}});
  }
  return (await request({action:'asset_finish',input:{media_id:asset.media_id}})).asset;
}

export function renderCutoutRefiner({request,task}){
  const host=el('div',undefined,'labcutouts');
  for(const [index,cut] of (task.result?.cutouts||[]).entries()){
    const box=el('section'),status=el('p'),preview=el('div'),actions=el('div');
    status.setAttribute('role','status');box.append(el('h4',`${cut.label||'Subject'} · outline ${index+1}`));
    const go=el('button','Refine with the real pixels');go.type='button';
    let current=null;
    go.onclick=async()=>{
      go.disabled=true;status.textContent='Loading the picture…';preview.replaceChildren();actions.replaceChildren();
      try{
        const original=await loadOriginal(request,cut.asset_id);
        status.textContent='Refining…';await new Promise(r=>setTimeout(r,20));
        const result=segmentSubject(original.pixels,cut.polygon);
        const canvas=cutoutCanvas(original.pixels,result.alpha);canvas.style.cssText='max-width:100%;height:auto;background:repeating-conic-gradient(#8884 0% 25%,#0000 0% 50%) 0 0/16px 16px';
        canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Refined cutout of ${cut.label||'the subject'} on a checkerboard`);
        preview.replaceChildren(canvas);
        const s=result.stats;current={original,result};
        status.textContent=`Done. Confidence: ${s.confidence}. ${CONFIDENCE[s.confidence]} The refined shape overlaps the AI outline by ${Math.round(s.agreementWithOutline*100)}%. Nothing is saved yet.`;
        const savePng=el('button','Save transparent cutout'),saveMask=el('button','Save mask');savePng.type=saveMask.type='button';
        const save=(btn,role,make,label)=>async()=>{btn.disabled=true;status.textContent='Saving…';
          try{const blob=await toPng(make());const asset=await saveDerived({request,parentId:cut.asset_id,blob,name:`${cut.label||'subject'} ${label}`,role,width:original.width,height:original.height,notes:`Refined from an AI outline by pixel color analysis (${s.confidence} confidence).`});
            status.textContent=`Saved ${asset.name} to your library, linked to the original.`;}
          catch(e){status.textContent=e.message||'Could not save.';btn.disabled=false;}};
        savePng.onclick=save(savePng,'cutout',()=>cutoutCanvas(original.pixels,result.alpha),'cutout');
        saveMask.onclick=save(saveMask,'mask',()=>maskCanvas(result.alpha,original.width,original.height),'mask');
        actions.append(savePng,saveMask);
      }catch(e){status.textContent=e.message||'Could not refine this outline.';}
      finally{go.disabled=false;}
    };
    box.append(go,status,preview,actions);host.append(box);
  }
  if(!host.children.length)host.append(el('p','This task has no outlines to refine.'));
  return host;
}
