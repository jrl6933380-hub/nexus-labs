// Cut-out tool for the Board. Outline the subject (trace with a finger, or tap points around it), and the Lab's pixel
// refiner turns the rough outline into a clean edge. Then paint "Keep" or "Remove" over mistakes and it re-fits the edge.
// The result is saved to the shared library as a cutout linked to the original picture. Nothing is saved until you press Save.
import {segmentSubject,rasterizePolygon,resizeAlpha} from './nexus-lab-segment.js';
import {loadOriginal,cutoutCanvas,saveDerived,buildHints} from './nexus-lab-cutout.js';
import {lassoPolygon,brushRadius,strokeSteps,limitAlpha} from './board-core.js?v=20261030-4';

const CONFIDENCE={high:'The subject stands out from the background, so the edge should be reliable.',medium:'The colors overlap a little. Check the edge before you rely on it.',low:'The subject and background look alike, so this edge is a best guess.'};
const PAINT={keep:'rgba(86,214,160,.55)',remove:'rgba(255,124,140,.55)'};
function h(tag,props={},...kids){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k.startsWith('on'))n[k]=v;else if(v!=null&&v!==false)n.setAttribute(k,v===true?'':v);}n.append(...kids);return n;}

export async function runCutter({request,item,onSaved}){
  const close=h('button',{type:'button',class:'pill','aria-label':'Close',text:'Close'});
  const status=h('p',{text:'Loading the picture…',role:'status','aria-live':'polite'});
  const chips=h('div',{class:'row chips'}),actions=h('div',{class:'row'});
  const stage=h('div',{class:'stage'}),root=h('div',{class:'cutter',role:'dialog','aria-modal':'true','aria-label':'Cut out'},
    h('div',{class:'top'},h('b',{text:'Cut out'}),close),stage,h('div',{class:'foot'},status,chips,actions));
  document.body.append(root);close.onclick=()=>root.remove();
  // outline: 'trace' (freehand) or 'points' (tap around the subject). After a cut, refinement strokes are painted with 'keep' or 'remove'.
  const S={outline:'trace',tool:'keep',size:'M',lasso:null,points:[],polygon:null,strokes:[],result:null,busy:false,paint:null};
  // Edits run on a smaller working copy so each touch-up takes seconds, not tens of seconds, on a phone; the saved cutout is scaled back to full size.
  const WORK_PIXELS=400000;
  let original,work,canvas,ctx;
  const chip=(label,pressed,on)=>h('button',{type:'button',class:'chip','aria-pressed':String(!!pressed),text:label,onclick:on});
  const btn=(label,on,{gold=false,disabled=false}={})=>h('button',{type:'button',class:gold?'gold':'',text:label,disabled,onclick:on});

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(S.result){
      ctx.drawImage(cutoutCanvas(work.pixels,S.result.alpha),0,0);
      for(const st of [...S.strokes,...(S.paint?[S.paint]:[])]){
        ctx.save();ctx.fillStyle=ctx.strokeStyle=PAINT[st.tool];ctx.lineWidth=st.r*2;ctx.lineCap=ctx.lineJoin='round';
        ctx.beginPath();st.pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
        if(st.pts.length===1){ctx.beginPath();ctx.arc(st.pts[0][0],st.pts[0][1],st.r,0,Math.PI*2);ctx.fill();}
        ctx.restore();
      }
      return;
    }
    ctx.putImageData(work.pixels,0,0);
    const line=S.lasso&&S.lasso.length>1?S.lasso:S.points.length?S.points:null;
    if(!line)return;
    const lw=Math.max(2,canvas.width/200);
    ctx.save();ctx.lineWidth=lw;ctx.strokeStyle='#e8c36a';ctx.setLineDash([lw*3,lw*2]);ctx.beginPath();line.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    if(S.lasso)ctx.closePath();ctx.stroke();ctx.restore();
    if(!S.lasso)for(const [x,y] of S.points){ctx.beginPath();ctx.arc(x,y,lw*2.2,0,Math.PI*2);ctx.fillStyle='#e8c36a';ctx.fill();}
  }
  function controls(){
    chips.replaceChildren();actions.replaceChildren();
    if(!S.result){
      chips.append(chip('Trace with finger',S.outline==='trace',()=>{S.outline='trace';S.points=[];S.lasso=null;controls();draw();status.textContent='Trace around the part you want to keep, all the way around, then lift your finger.';}),
        chip('Tap points',S.outline==='points',()=>{S.outline='points';S.points=[];S.lasso=null;controls();draw();status.textContent='Tap points around the part you want to keep, one after another. Tap Finish when you are back where you started.';}));
      if(S.outline==='points')actions.append(btn('Undo point',()=>{S.points.pop();controls();draw();},{disabled:!S.points.length||S.busy}),btn('Finish outline',()=>cutFrom(S.points),{gold:true,disabled:S.points.length<3||S.busy}));
      return;
    }
    chips.append(chip('Keep',S.tool==='keep',()=>{S.tool='keep';controls();}),chip('Remove',S.tool==='remove',()=>{S.tool='remove';controls();}),
      ...['S','M','L'].map(z=>chip(z,S.size===z,()=>{S.size=z;controls();})));
    actions.append(btn('Undo',()=>{S.strokes.pop();refit();},{disabled:!S.strokes.length||S.busy}),btn('Start over',reset,{disabled:S.busy}),btn('Save cutout',save,{gold:true,disabled:S.busy}));
  }
  function reset(){
    Object.assign(S,{lasso:null,points:[],polygon:null,strokes:[],result:null,paint:null});
    draw();controls();status.textContent=S.outline==='points'?'Tap points around the part you want to keep, one after another. Tap Finish when you are back where you started.':'Trace around the part you want to keep, all the way around, then lift your finger.';
  }
  // Runs the Lab refiner on the stored outline plus any painted strokes. A short delay lets the screen show "working" first.
  function fit(message){
    S.busy=true;controls();status.textContent=message;
    setTimeout(()=>{try{
      const hints=S.strokes.length?buildHints(S.strokes,canvas.width,canvas.height):undefined;
      S.result=segmentSubject(work.pixels,S.polygon,{hints});
      const w=canvas.width,h=canvas.height,margin=Math.max(2,Math.round(0.015*Math.min(w,h)));
      S.result.alpha=limitAlpha(S.result.alpha,rasterizePolygon(S.polygon,w,h),w,h,margin,S.strokes.filter(st=>st.tool==='keep'));
      status.textContent=S.strokes.length?`Edge updated. Paint Keep or Remove over anything still wrong. ${CONFIDENCE[S.result.stats.confidence]||''} Nothing is saved yet.`
        :`Done. ${CONFIDENCE[S.result.stats.confidence]||''} Paint Keep over missing parts or Remove over leftovers to fix the edge. Nothing is saved yet.`;
    }catch(e){
      if(S.strokes.length){S.strokes.pop();status.textContent=(e.message||'That change could not be applied.')+' The last stroke was undone.';}
      else{S.result=null;S.polygon=null;S.lasso=null;S.points=[];status.textContent=e.message||'Could not cut that out. Try a tighter outline.';}
    }finally{S.busy=false;draw();controls();}},20);
  }
  const refit=()=>fit('Updating the edge…');
  function cutFrom(points){
    if(S.busy)return;
    if(points.length<(S.outline==='points'?3:12)){const mode=S.outline;reset();S.outline=mode;controls();status.textContent=mode==='points'?'Tap at least 3 points around the subject.':'That outline was too short. Trace all the way around the subject.';return;}
    S.polygon=lassoPolygon(points,canvas.width,canvas.height);S.lasso=S.outline==='trace'?points:null;fit('Cutting it out…');
  }
  try{
    original=await loadOriginal(request,item.media_id);
    const scale=Math.min(1,Math.sqrt(WORK_PIXELS/(original.width*original.height)));
    if(scale<1){const ww=Math.max(1,Math.round(original.width*scale)),hh=Math.max(1,Math.round(original.height*scale)),c=document.createElement('canvas');c.width=ww;c.height=hh;
      const cx=c.getContext('2d',{willReadFrequently:true});cx.drawImage(original.bitmap,0,0,ww,hh);work={width:ww,height:hh,pixels:cx.getImageData(0,0,ww,hh)};}
    else work={width:original.width,height:original.height,pixels:original.pixels};
    canvas=h('canvas',{width:work.width,height:work.height,'aria-label':'Picture to outline'});ctx=canvas.getContext('2d');stage.append(canvas);reset();
  }catch(e){status.textContent=e.message||'Could not load this picture.';return;}
  const at=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};
  canvas.onpointerdown=e=>{
    if(S.busy)return;canvas.setPointerCapture(e.pointerId);e.preventDefault();
    if(S.result){S.paint={tool:S.tool,r:brushRadius(S.size,canvas.width,canvas.height),pts:[at(e)]};draw();}
    else if(S.outline==='trace')S.lasso=[at(e)];
    else S.down=at(e);
  };
  canvas.onpointermove=e=>{
    if(S.busy)return;
    if(S.paint){const last=S.paint.pts[S.paint.pts.length-1];S.paint.pts.push(...strokeSteps(last,at(e),S.paint.r/2));draw();}
    else if(S.outline==='trace'&&S.lasso&&!S.result){S.lasso.push(at(e));draw();}
  };
  canvas.onpointerup=e=>{
    if(S.busy)return;
    if(S.paint){const st=S.paint;S.paint=null;S.strokes.push(st);refit();}
    else if(S.result)return;
    else if(S.outline==='trace'){if(S.lasso)cutFrom(S.lasso);}
    else if(S.down){S.points.push(at(e));S.down=null;draw();controls();status.textContent=`${S.points.length} point${S.points.length===1?'':'s'}. ${S.points.length<3?'Keep tapping around the subject.':'Tap Finish when you have gone all the way around.'}`;}
  };
  canvas.onpointercancel=()=>{S.paint=null;S.down=null;if(!S.result&&S.outline==='trace'){S.lasso=null;draw();}};
  async function save(){
    if(!S.result||S.busy)return;S.busy=true;controls();status.textContent='Saving to your library…';
    try{
      const full=resizeAlpha(S.result.alpha,work.width,work.height,original.width,original.height);
      const clean=cutoutCanvas(original.pixels,full); // full size, saved without the green and red paint
      const blob=await new Promise((ok,no)=>clean.toBlob(b=>b?ok(b):no(Error('Could not make a PNG.')),'image/png'));
      const edits=S.strokes.length?` and touched up with ${S.strokes.length} keep/remove stroke${S.strokes.length===1?'':'s'}`:'';
      const asset=await saveDerived({request,parentId:item.media_id,blob,name:`${(item.title||'picture').slice(0,60)} cutout`,role:'cutout',width:original.width,height:original.height,
        notes:`Cut out on the Nexus Board by outlining${edits}; edge refined from pixel colors (${S.result.stats.confidence} confidence).`});
      root.remove();onSaved(asset);
    }catch(e){status.textContent=e.message||'Could not save.';S.busy=false;controls();}
  }
}
