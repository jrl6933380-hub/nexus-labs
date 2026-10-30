import {worldLayers,point,mediaIds} from './board-scene-core.js';
import {loadOriginal} from './nexus-lab-cutout.js';
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
function maskPath(ctx,stroke,w,h){
  ctx.lineCap=ctx.lineJoin='round';ctx.lineWidth=stroke.size*Math.min(w,h);ctx.beginPath();
  stroke.points.forEach(([x,y],i)=>i?ctx.lineTo(x*w,y*h):ctx.moveTo(x*w,y*h));
  if(stroke.points.length===1){const [x,y]=stroke.points[0];ctx.arc(x*w,y*h,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();
}
function shapePath(ctx,l){ctx.beginPath();if(l.shape==='ellipse')ctx.ellipse(l.w/2,l.h/2,l.w/2,l.h/2,0,0,Math.PI*2);else ctx.rect(0,0,l.w,l.h);}
export function createSceneRenderer(request){
  const images=new Map(),surfaces=new Map();let disposed=false;
  function trim(scene){const ids=new Set(scene.layers.map(l=>l.id));for(const key of surfaces.keys())if(!ids.has(key))surfaces.delete(key);}
  function surface(l){
    const signature=JSON.stringify({...l,x:0,y:0,rotation:0,motion:null,pivot:null,opacity:1});
    const old=surfaces.get(l.id);if(old?.signature===signature)return old.canvas;
    const ratio=Math.min(1,Math.sqrt(400000/(l.w*l.h))),w=Math.max(1,Math.round(l.w*ratio)),h=Math.max(1,Math.round(l.h*ratio));
    const c=makeCanvas(w,h),ctx=c.getContext('2d');ctx.scale(w/l.w,h/l.h);
    if(l.type==='image'){const image=images.get(l.media_id);if(image)ctx.drawImage(image.bitmap,0,0,l.w,l.h);}
    else if(l.type==='shape'){ctx.fillStyle=l.color;shapePath(ctx,l);ctx.fill();}
    else if(l.type==='text'){ctx.fillStyle=l.color;ctx.font=l.font_size+'px Arial,sans-serif';ctx.textBaseline='top';ctx.fillText(l.text,0,0,l.w);}
    if(l.mask){
      const mask=makeCanvas(w,h),m=mask.getContext('2d');m.scale(w/l.w,h/l.h);m.fillStyle=m.strokeStyle='#fff';
      if(l.mask.base==='visible')m.fillRect(0,0,l.w,l.h);
      for(const s of l.mask.strokes){m.globalCompositeOperation=s.op==='add'?'source-over':'destination-out';maskPath(m,s,l.w,l.h);}
      ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);
    }
    surfaces.set(l.id,{signature,canvas:c});return c;
  }
  function draw(canvas,scene,time=0,{selected='',guides=false,masking=false}={}){
    trim(scene);const ctx=canvas.getContext('2d'),scale=canvas.width/scene.width;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    if(scene.background!=='transparent'){ctx.fillStyle=scene.background;ctx.fillRect(0,0,canvas.width,canvas.height);}
    const {entries,map}=worldLayers(scene,time);
    const transform=m=>ctx.setTransform(...m.map((v,i)=>i<6?v*scale:v));
    for(const e of entries){
      const l=e.layer;if(!e.visible||['group','zone'].includes(l.type))continue;ctx.save();
      if(l.zone_id){const z=map.get(l.zone_id);if(z){transform(z.matrix);shapePath(ctx,z.layer);ctx.clip();}}
      transform(e.matrix);ctx.globalAlpha=e.opacity;ctx.globalCompositeOperation=l.blend;
      if(l.shadow){ctx.shadowColor=l.shadow.color;ctx.shadowBlur=l.shadow.blur*scale;ctx.shadowOffsetX=l.shadow.dx*scale;ctx.shadowOffsetY=l.shadow.dy*scale;}
      if(masking&&selected===l.id&&l.type==='image'&&images.get(l.media_id)){ctx.globalAlpha=.2;ctx.drawImage(images.get(l.media_id).bitmap,0,0,l.w,l.h);ctx.globalAlpha=e.opacity;}
      ctx.drawImage(surface(l),0,0,l.w,l.h);ctx.restore();
    }
    if(guides)for(const e of entries){
      const l=e.layer;if(!e.visible||(l.type!=='zone'&&l.id!==selected))continue;ctx.save();transform(e.matrix);
      ctx.globalAlpha=1;ctx.lineWidth=2/scale;ctx.strokeStyle=l.tag;ctx.setLineDash(l.type==='zone'?[12/scale,8/scale]:[]);
      if(l.type==='zone'){ctx.fillStyle=l.tag+'22';shapePath(ctx,l);ctx.fill();ctx.stroke();}else ctx.strokeRect(0,0,l.w,l.h);
      if(l.id===selected){ctx.fillStyle=l.tag;ctx.beginPath();ctx.arc(l.pivot.x*l.w,l.pivot.y*l.h,6/scale,0,Math.PI*2);ctx.fill();
        if(masking&&l.mask){for(const s of l.mask.strokes){ctx.globalAlpha=.25;ctx.strokeStyle=ctx.fillStyle=s.op==='add'?l.tag:'#ff758e';maskPath(ctx,s,l.w,l.h);}}
      }ctx.restore();
    }
    ctx.setTransform(1,0,0,1,0,0);return canvas;
  }
  return {
    draw,images,
    layerPng:layer=>surface(layer).toDataURL('image/png'),
    async load(scene){
      const wanted=mediaIds(scene);
      for(const key of images.keys())if(!wanted.includes(key)){images.get(key).bitmap.close?.();images.delete(key);}
      for(const mediaId of wanted){
        if(disposed)return;if(images.has(mediaId))continue;
        const source=await loadOriginal(request,mediaId);let bitmap=source.bitmap;
        const r=Math.min(1,Math.sqrt(600000/(bitmap.width*bitmap.height)));
        if(r<1){const smaller=await createImageBitmap(bitmap,{resizeWidth:Math.max(1,Math.round(bitmap.width*r)),resizeHeight:Math.max(1,Math.round(bitmap.height*r))});bitmap.close?.();bitmap=smaller;}
        if(disposed){bitmap.close?.();return;}images.set(mediaId,{asset:source.asset,bitmap});
      }
      surfaces.clear();
    },
    dispose(){disposed=true;for(const image of images.values())image.bitmap.close?.();images.clear();surfaces.clear();}
  };
}
export function sceneControlsHtml(target,duration){
  return '<style>body{font:16px system-ui;background:#10251e;color:#ecf8ef;padding:14px}button,input{min-height:44px}button{background:#8ed9b6;border:0;border-radius:10px;padding:10px;margin-right:8px}input{width:100%}</style><b>Scene controls</b><p><button id="play">Play</button><button id="pause">Pause</button></p><label>Time <input id="time" type="range" min="0" max="'+duration+'" step=".05" value="0"></label><small id="state">Ready · controls only this scene</small><script>const target='+JSON.stringify(target)+';function send(command,time){parent.postMessage({type:"nexus-scene-control",target_id:target,command,time},"*")}document.getElementById("play").onclick=()=>send("play");document.getElementById("pause").onclick=()=>send("pause");document.getElementById("time").oninput=e=>send("seek",Number(e.target.value));<'+ '/script>';
}
