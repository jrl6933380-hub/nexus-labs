// Image-only composition geometry. Coordinates are fractions of the output frame.
export const MAX_COMPOSE_PIXELS=4000000;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export function outputSize(w,h,max=MAX_COMPOSE_PIXELS){
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<1||h<1||!Number.isFinite(max)||max<1)throw Error('Choose valid image dimensions.');
  const s=Math.min(1,4096/w,4096/h,Math.sqrt(max/(w*h)));
  return {width:Math.max(1,Math.floor(w*s)),height:Math.max(1,Math.floor(h*s))};
}
export function coverRect(sw,sh,w,h){
  const scale=Math.max(w/sw,h/sh);
  return {x:(w-sw*scale)/2,y:(h-sh*scale)/2,w:sw*scale,h:sh*scale};
}
export function foregroundRect(sw,sh,w,h,{x=.5,y=.5,scale=.85}={}){
  const s=Math.min(w/sw,h/sh)*clamp(scale,.1,3);
  return {x:clamp(x,-.5,1.5)*w-sw*s/2,y:clamp(y,-.5,1.5)*h-sh*s/2,w:sw*s,h:sh*s};
}
export function paintComposition(canvas,background,foreground,placement){
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image compositing is unavailable.');
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const bg=coverRect(background.width,background.height,canvas.width,canvas.height);
  ctx.drawImage(background,bg.x,bg.y,bg.w,bg.h);
  const fg=foregroundRect(foreground.width,foreground.height,canvas.width,canvas.height,placement);
  ctx.drawImage(foreground,fg.x,fg.y,fg.w,fg.h);
  return canvas;
}
