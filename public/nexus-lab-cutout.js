// Refine a connected AI's rough Cutout outline into a pixel-accurate mask, in the browser.
// Nothing leaves the device except the saved result, and nothing is saved until you press Save.
import {segmentSubject,applyMask} from './nexus-lab-segment.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const MAX_PIXELS=1200000; // refine at up to 1.2 megapixels so touch-ups stay quick on a phone; bigger pictures are scaled down first
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

// Turns the user's strokes into a per-pixel hint map: 1 = keep, 0 = remove, -1 = no opinion. Later strokes win.
export function buildHints(strokes,width,height){
  const hints=new Int8Array(width*height).fill(-1);
  for(const stroke of strokes){
    const value=stroke.tool==='keep'?1:0,r=Math.max(1,stroke.r),r2=r*r;
    for(const [cx,cy] of stroke.pts){
      const x0=Math.max(0,Math.floor(cx-r)),x1=Math.min(width-1,Math.ceil(cx+r)),y0=Math.max(0,Math.floor(cy-r)),y1=Math.min(height-1,Math.ceil(cy+r));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if((x-cx)**2+(y-cy)**2<=r2)hints[y*width+x]=value;
    }
  }
  return hints;
}
export const strokeWords=n=>`${n} hand stroke${n===1?'':'s'}`;
const COLORS={keep:'rgba(60,200,110,.55)',remove:'rgba(240,70,70,.55)'};
function drawStrokes(overlay,strokes){
  const g=overlay.getContext('2d');g.clearRect(0,0,overlay.width,overlay.height);g.lineCap='round';g.lineJoin='round';
  for(const st of strokes){g.strokeStyle=g.fillStyle=COLORS[st.tool];g.lineWidth=st.r*2;g.beginPath();
    st.pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));if(st.pts.length===1)g.lineTo(st.pts[0][0]+.01,st.pts[0][1]);g.stroke();}
}

export function renderCutoutRefiner({request,task}){
  const host=el('div',undefined,'labcutouts');
  for(const [index,cut] of (task.result?.cutouts||[]).entries()){
    const box=el('section'),status=el('p'),stage=el('div'),tools=el('div'),actions=el('div');
    status.setAttribute('role','status');box.append(el('h4',`${cut.label||'Subject'} · outline ${index+1}`));
    const go=el('button','Refine with the real pixels');go.type='button';
    let original=null,result=null,strokes=[],tool='keep',overlay=null,previewHost=null;
    const stats=()=>{const s=result.stats;return `Confidence: ${s.confidence}. ${CONFIDENCE[s.confidence]} The refined shape overlaps the AI outline by ${Math.round(s.agreementWithOutline*100)}%.`;};
    function show(){
      const canvas=cutoutCanvas(original.pixels,result.alpha);
      canvas.style.cssText='display:block;width:100%;height:auto;background:repeating-conic-gradient(#8884 0% 25%,#0000 0% 50%) 0 0/16px 16px';
      canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Refined cutout of ${cut.label||'the subject'} on a checkerboard`);
      previewHost.replaceChildren(canvas);previewHost.append(overlay);
    }
    function refine(note){
      status.textContent='Refining…';
      setTimeout(()=>{
        try{result=segmentSubject(original.pixels,cut.polygon,{hints:strokes.length?buildHints(strokes,original.width,original.height):undefined});show();
          status.textContent=`${note} ${stats()} Nothing is saved yet.`;}
        catch(e){status.textContent=e.message||'Could not refine this outline.';}
        finally{redo.disabled=false;}
      },20);
    }
    const keepBtn=el('button','Keep'),removeBtn=el('button','Remove'),undo=el('button','Undo'),clear=el('button','Clear'),redo=el('button','Re-refine','labprimary');
    for(const b of [keepBtn,removeBtn,undo,clear,redo])b.type='button';
    const size=document.createElement('input');size.type='range';size.min='2';size.max='40';size.value='12';size.setAttribute('aria-label','Brush size');
    const setTool=t=>{tool=t;keepBtn.setAttribute('aria-pressed',String(t==='keep'));removeBtn.setAttribute('aria-pressed',String(t==='remove'));};
    keepBtn.onclick=()=>setTool('keep');removeBtn.onclick=()=>setTool('remove');
    undo.onclick=()=>{strokes.pop();drawStrokes(overlay,strokes);};clear.onclick=()=>{strokes=[];drawStrokes(overlay,strokes);};
    redo.onclick=()=>{redo.disabled=true;refine(strokes.length?`Re-refined with ${strokeWords(strokes.length).replace('hand ','')}.`:'Re-refined.');};
    tools.append(keepBtn,removeBtn,el('span','Brush'),size,undo,clear,redo);
    tools.setAttribute('role','group');tools.setAttribute('aria-label','Touch-up tools');
    function startEditor(){
      previewHost=el('div');previewHost.style.cssText='position:relative;touch-action:none';
      overlay=document.createElement('canvas');overlay.width=original.width;overlay.height=original.height;
      overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair';
      overlay.setAttribute('aria-label','Paint here to keep or remove parts');
      let current=null;
      const at=e=>{const r=overlay.getBoundingClientRect();return [(e.clientX-r.left)*overlay.width/r.width,(e.clientY-r.top)*overlay.height/r.height];};
      overlay.onpointerdown=e=>{overlay.setPointerCapture(e.pointerId);const scale=overlay.width/overlay.getBoundingClientRect().width;current={tool,r:Number(size.value)*scale/2,pts:[at(e)]};strokes.push(current);drawStrokes(overlay,strokes);e.preventDefault();};
      overlay.onpointermove=e=>{if(!current)return;current.pts.push(at(e));drawStrokes(overlay,strokes);};
      const end=()=>{current=null;};overlay.onpointerup=end;overlay.onpointercancel=end;
      stage.replaceChildren(previewHost,el('p','Paint green (Keep) on parts that should stay and red (Remove) on parts that should go, then press Re-refine. A short stroke is enough; it teaches the colors.','labnote'),tools);
      setTool('keep');show();
    }
    go.onclick=async()=>{
      go.disabled=true;status.textContent='Loading the picture…';stage.replaceChildren();actions.replaceChildren();strokes=[];
      try{
        original=await loadOriginal(request,cut.asset_id);
        status.textContent='Refining…';await new Promise(r=>setTimeout(r,20));
        result=segmentSubject(original.pixels,cut.polygon);
        startEditor();redo.disabled=false;status.textContent=`Done. ${stats()} Nothing is saved yet.`;
        const savePng=el('button','Save transparent cutout'),saveMask=el('button','Save mask');savePng.type=saveMask.type='button';
        const save=(btn,role,make,label)=>async()=>{btn.disabled=true;status.textContent='Saving…';
          try{const blob=await toPng(make());const s=result.stats;const asset=await saveDerived({request,parentId:cut.asset_id,blob,name:`${cut.label||'subject'} ${label}`,role,width:original.width,height:original.height,notes:`Refined from an AI outline by pixel color analysis (${s.confidence} confidence${strokes.length?`, ${strokeWords(strokes.length)}`:''}).`});
            status.textContent=`Saved ${asset.name} to your library, linked to the original.`;}
          catch(e){status.textContent=e.message||'Could not save.';}finally{btn.disabled=false;}};
        savePng.onclick=save(savePng,'cutout',()=>cutoutCanvas(original.pixels,result.alpha),'cutout');
        saveMask.onclick=save(saveMask,'mask',()=>maskCanvas(result.alpha,original.width,original.height),'mask');
        actions.append(savePng,saveMask);
      }catch(e){status.textContent=e.message||'Could not refine this outline.';}
      finally{go.disabled=false;}
    };
    box.append(go,status,stage,actions);host.append(box);
  }
  if(!host.children.length)host.append(el('p','This task has no outlines to refine.'));
  return host;
}
