// Pure helpers for the Nexus Board. No DOM access, so they run under Node tests too.
export const ZOOM_MIN=0.2,ZOOM_MAX=4;
export const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
// An inline visual runs in a sandboxed frame with no network, no storage and no access to the page around it.
export const VISUAL_CSP="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src data:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
export function buildVisualDocument(code){
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${VISUAL_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;background:#071016;color:#e8fbff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}svg,img,canvas,video{display:block;max-width:100%}</style></head><body>${String(code||'')}</body></html>`;
}
export const screenToWorld=(view,p)=>({x:(p.x-view.x)/view.z,y:(p.y-view.y)/view.z});
// Zoom by `factor` keeping the world point under screen point `p` fixed.
export function zoomAt(view,p,factor){
  const z=clamp(view.z*factor,ZOOM_MIN,ZOOM_MAX),w=screenToWorld(view,p);
  return {x:p.x-w.x*z,y:p.y-w.y*z,z};
}
// Smallest view that shows every item with some margin; an empty board resets to the origin.
export function fitView(items,size,margin=40){
  if(!items.length)return {x:size.w/2-140,y:size.h/2-100,z:1};
  const x1=Math.min(...items.map(i=>i.x)),y1=Math.min(...items.map(i=>i.y)),x2=Math.max(...items.map(i=>i.x+i.w)),y2=Math.max(...items.map(i=>i.y+i.h));
  const z=clamp(Math.min((size.w-margin*2)/(x2-x1),(size.h-margin*2-120)/(y2-y1)),ZOOM_MIN,1.5);
  return {x:size.w/2-((x1+x2)/2)*z,y:(size.h-60)/2-((y1+y2)/2)*z+30,z};
}
// Keep a hand stroke light: drop points closer than `min` world units to the previous kept one.
export function addPoint(points,pt,min=2){
  const last=points[points.length-1];
  if(last&&Math.hypot(pt[0]-last[0],pt[1]-last[1])<min)return false;
  points.push([Math.round(pt[0]*10)/10,Math.round(pt[1]*10)/10]);return true;
}
export const inRect=(p,r)=>p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.w&&p.y<=r.y+r.h;
// Smooth path through the points for a sketch stroke (quadratic midpoints). A single point becomes a dot.
export function strokePath(points){
  if(!points.length)return '';
  if(points.length===1){const [x,y]=points[0];return `M${x} ${y}l0.01 0`;}
  let d=`M${points[0][0]} ${points[0][1]}`;
  for(let i=1;i<points.length-1;i++){const [x,y]=points[i],[nx,ny]=points[i+1];d+=`Q${x} ${y} ${(x+nx)/2} ${(y+ny)/2}`;}
  const [lx,ly]=points[points.length-1];return d+`L${lx} ${ly}`;
}
// Reduce a lasso to at most `max` points, as 0-1 fractions of the picture, for the Lab refiner.
export function lassoPolygon(points,width,height,max=60){
  const step=Math.max(1,Math.ceil(points.length/max)),out=[];
  for(let i=0;i<points.length;i+=step)out.push([clamp(points[i][0]/width,0,1),clamp(points[i][1]/height,0,1)]);
  return out;
}
export const newId=()=>{const a=new Uint8Array(8);crypto.getRandomValues(a);return 'i'+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');};
export const LOOKS=[['plain','Plain'],['grid','Grid'],['dots','Dots'],['paper','Paper'],['night','Night']];
export const SWATCHES=['#0e1412','#172019','#1b2433','#2b1d2f','#3a2a12','#f3ecd9'];
export const INK=['#e8c36a','#f5efe0','#56d6a0','#5db8ff','#ff7c8c','#0e1412'];
export const lookGrid={plain:0,grid:32,dots:28,paper:32,night:0};
