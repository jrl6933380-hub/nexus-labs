// Cut-out tool for the Board. Outline the subject with a finger; the Lab's pixel refiner turns the rough outline
// into a clean edge, and the result is saved to the shared library as a cutout linked to the original picture.
import {segmentSubject} from './nexus-lab-segment.js';
import {loadOriginal,cutoutCanvas,saveDerived} from './nexus-lab-cutout.js';
import {lassoPolygon} from './board-core.js?v=20261030-2';

const CONFIDENCE={high:'The subject stands out from the background, so the edge should be reliable.',medium:'The colors overlap a little. Check the edge before you rely on it.',low:'The subject and background look alike, so this edge is a best guess.'};
function h(tag,props={},...kids){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k.startsWith('on'))n[k]=v;else if(v!=null&&v!==false)n.setAttribute(k,v===true?'':v);}n.append(...kids);return n;}

export async function runCutter({request,item,onSaved}){
  const close=h('button',{type:'button',class:'pill','aria-label':'Close',text:'Close'});
  const status=h('p',{text:'Loading the picture…',role:'status','aria-live':'polite'});
  const retry=h('button',{type:'button',text:'Start over',disabled:true}),save=h('button',{type:'button',class:'gold',text:'Save cutout',disabled:true});
  const stage=h('div',{class:'stage'}),root=h('div',{class:'cutter',role:'dialog','aria-modal':'true','aria-label':'Cut out'},
    h('div',{class:'top'},h('b',{text:'Cut out'}),close),stage,h('div',{class:'foot'},status,h('div',{class:'row'},retry,save)));
  document.body.append(root);close.onclick=()=>root.remove();
  let original,canvas,ctx,lasso=null,result=null,busy=false;
  const redraw=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.putImageData(original.pixels,0,0);};
  function reset(){result=null;lasso=null;save.disabled=true;retry.disabled=true;redraw();status.textContent='Trace around the part you want to keep, all the way around, then lift your finger.';}
  try{
    original=await loadOriginal(request,item.media_id);
    canvas=h('canvas',{width:original.width,height:original.height,'aria-label':'Picture to outline'});ctx=canvas.getContext('2d');stage.append(canvas);reset();
  }catch(e){status.textContent=e.message||'Could not load this picture.';return;}
  const at=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};
  const drawLasso=()=>{redraw();if(!lasso||lasso.length<2)return;ctx.save();ctx.lineWidth=Math.max(2,canvas.width/200);ctx.strokeStyle='#e8c36a';ctx.setLineDash([ctx.lineWidth*3,ctx.lineWidth*2]);ctx.beginPath();lasso.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.stroke();ctx.restore();};
  canvas.onpointerdown=e=>{if(busy||result)return;canvas.setPointerCapture(e.pointerId);lasso=[at(e)];e.preventDefault();};
  canvas.onpointermove=e=>{if(!lasso||busy||result)return;lasso.push(at(e));drawLasso();};
  const finish=()=>{
    if(!lasso||busy||result)return;
    if(lasso.length<12){reset();status.textContent='That outline was too short. Trace all the way around the subject.';return;}
    busy=true;status.textContent='Cutting it out…';
    setTimeout(()=>{try{
      const polygon=lassoPolygon(lasso,canvas.width,canvas.height);result=segmentSubject(original.pixels,polygon);
      const out=cutoutCanvas(original.pixels,result.alpha);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(out,0,0);
      status.textContent=`Done. ${CONFIDENCE[result.stats.confidence]||''} Nothing is saved yet.`;save.disabled=false;retry.disabled=false;
    }catch(e){result=null;status.textContent=e.message||'Could not cut that out. Try a tighter outline.';redraw();retry.disabled=false;}finally{busy=false;}},20);
  };
  canvas.onpointerup=finish;canvas.onpointercancel=()=>{if(!result)reset();};
  retry.onclick=reset;
  save.onclick=async()=>{
    if(!result||busy)return;busy=true;save.disabled=true;status.textContent='Saving to your library…';
    try{
      const blob=await new Promise((ok,no)=>canvas.toBlob(b=>b?ok(b):no(Error('Could not make a PNG.')),'image/png'));
      const asset=await saveDerived({request,parentId:item.media_id,blob,name:`${(item.title||'picture').slice(0,60)} cutout`,role:'cutout',width:canvas.width,height:canvas.height,
        notes:`Cut out on the Nexus Board by outlining with a finger; edge refined from pixel colors (${result.stats.confidence} confidence).`});
      root.remove();onSaved(asset);
    }catch(e){status.textContent=e.message||'Could not save.';save.disabled=false;}finally{busy=false;}
  };
}
