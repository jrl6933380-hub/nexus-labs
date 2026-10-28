// Offline segmentation refiner for Lab Cutout. No model, no service, no cost.
// An AI (or a person) gives a rough polygon; this turns it into a pixel-accurate soft mask
// by looking at the actual pixels. Works on plain RGBA bytes, so the same file runs in the
// browser (canvas ImageData) and on the server.
//
// How it works, in four steps:
//  1. The polygon is drawn into a coarse mask.
//  2. A band around its edge is marked "unknown"; everything well inside is sure subject,
//     everything well outside is sure background.
//  3. Colors of the sure areas teach two color histograms (subject vs background).
//  4. Unknown pixels are settled by balancing "which histogram does my color fit" against
//     "agree with my neighbors unless there is a strong color edge between us".
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const BINS=16, SHIFT=4;
const bin=(d,i)=>((d[i]>>SHIFT)<<8)|((d[i+1]>>SHIFT)<<4)|(d[i+2]>>SHIFT);

export function rasterizePolygon(polygon,w,h){
  const mask=new Uint8Array(w*h),pts=polygon.map(([x,y])=>[x*w,y*h]),n=pts.length;
  for(let y=0;y<h;y++){const cy=y+0.5,xs=[];
    for(let i=0;i<n;i++){const [x1,y1]=pts[i],[x2,y2]=pts[(i+1)%n];if((y1<=cy&&y2>cy)||(y2<=cy&&y1>cy))xs.push(x1+(cy-y1)*(x2-x1)/(y2-y1));}
    xs.sort((a,b)=>a-b);
    for(let k=0;k+1<xs.length;k+=2){const a=Math.max(0,Math.ceil(xs[k]-0.5)),b=Math.min(w-1,Math.ceil(xs[k+1]-0.5)-1);for(let x=a;x<=b;x++)mask[y*w+x]=1;}}
  return mask;
}
// Distance (in pixels, chamfer 3-4) from each pixel to the nearest pixel where isTarget is true.
function distanceTo(isTarget,w,h){
  const INF=1e9,d=new Float32Array(w*h);for(let i=0;i<d.length;i++)d[i]=isTarget(i)?0:INF;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;let v=d[i];if(v===0)continue;
    if(x>0)v=Math.min(v,d[i-1]+1);if(y>0){v=Math.min(v,d[i-w]+1);if(x>0)v=Math.min(v,d[i-w-1]+1.414);if(x<w-1)v=Math.min(v,d[i-w+1]+1.414);}d[i]=v;}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;let v=d[i];if(v===0)continue;
    if(x<w-1)v=Math.min(v,d[i+1]+1);if(y<h-1){v=Math.min(v,d[i+w]+1);if(x<w-1)v=Math.min(v,d[i+w+1]+1.414);if(x>0)v=Math.min(v,d[i+w-1]+1.414);}d[i]=v;}
  return d;
}
export function segmentSubject({data,width:w,height:h},polygon,{band,iterations=160,smooth=1.2}={}){
  if(!data||!w||!h||data.length!==w*h*4)throw fail('Supply RGBA pixels with matching width and height.');
  if(w*h>4e6)throw fail('Image is too large for refinement; scale it to under 4 megapixels first.');
  if(!Array.isArray(polygon)||polygon.length<3||polygon.some(p=>!Array.isArray(p)||p.length!==2||!p.every(v=>Number.isFinite(v)&&v>=-0.05&&v<=1.05)))throw fail('Supply a polygon of at least 3 points as 0–1 fractions.');
  const coarse=rasterizePolygon(polygon,w,h);let coarseCount=0;for(let i=0;i<coarse.length;i++)coarseCount+=coarse[i];
  if(!coarseCount)throw fail('The outline covers no pixels.');
  const dOut=distanceTo(i=>coarse[i]===0,w,h),dIn=distanceTo(i=>coarse[i]===1,w,h); // dOut: inside pixels' distance to outside; dIn: outside pixels' distance to inside
  // The unknown band is about 8% of the picture, but never more than 40% of how thick the subject is,
  // so a thin subject (a banner, a strip of building) still keeps a sure core to learn its colors from.
  let thickest=0;for(let i=0;i<coarse.length;i++)if(coarse[i]&&dOut[i]>thickest)thickest=dOut[i];
  const B=band??Math.max(2,Math.min(Math.round(0.08*Math.min(w,h)),Math.floor(thickest*0.4)));
  // trimap: 1 sure subject, 0 sure background, -1 unknown
  const tri=new Int8Array(w*h);let nFg=0,nBg=0,nUn=0;
  for(let i=0;i<tri.length;i++){if(coarse[i]){if(dOut[i]>B){tri[i]=1;nFg++;}else{tri[i]=-1;nUn++;}}else{if(dIn[i]>B){tri[i]=0;nBg++;}else{tri[i]=-1;nUn++;}}}
  if(nFg<20||nBg<20)throw fail('The outline is too small, or fills the whole picture, to learn colors from.');
  // color histograms with add-one smoothing
  const hf=new Float64Array(BINS**3).fill(1),hb=new Float64Array(BINS**3).fill(1);let sf=hf.length,sb=hb.length;
  const mf=[0,0,0],mb=[0,0,0];
  for(let i=0;i<tri.length;i++){if(tri[i]===1){hf[bin(data,i*4)]++;sf++;for(let k=0;k<3;k++)mf[k]+=data[i*4+k];}else if(tri[i]===0){hb[bin(data,i*4)]++;sb++;for(let k=0;k<3;k++)mb[k]+=data[i*4+k];}}
  const colourGap=Math.hypot(...[0,1,2].map(k=>mf[k]/nFg-mb[k]/nBg));
  // how different the two color sets are (Bhattacharyya distance, 0 = identical)
  let bc=0;for(let k=0;k<hf.length;k++)bc+=Math.sqrt((hf[k]/sf)*(hb[k]/sb));const separability=Math.min(1,Math.max(0,1-bc));
  // unary: subject probability from color, blended with the polygon's own opinion (distance from its edge)
  let prob=new Float32Array(w*h);const unary=new Float32Array(w*h);
  for(let i=0;i<tri.length;i++){
    if(tri[i]===1){prob[i]=1;continue;}if(tri[i]===0){prob[i]=0;continue;}
    const k=bin(data,i*4),pf=hf[k]/sf,pb=hb[k]/sb,colour=pf/(pf+pb);
    const signed=coarse[i]?dOut[i]:-dIn[i],prior=1/(1+Math.exp(-signed/(B*0.45)));
    unary[i]=0.7*colour+0.3*prior;prob[i]=unary[i];}
  // edge-aware weights: neighbors with very different colors barely influence each other
  let sum=0,cnt=0;const diff=(a,b)=>{const dr=data[a]-data[b],dg=data[a+1]-data[b+1],db=data[a+2]-data[b+2];return dr*dr+dg*dg+db*db;};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(x<w-1){sum+=diff(i,i+4);cnt++;}if(y<h-1){sum+=diff(i,i+w*4);cnt++;}}
  const beta=1/(2*(sum/Math.max(1,cnt))+1e-6);
  const wr=new Float32Array(w*h),wd=new Float32Array(w*h); // weight to right and down neighbor
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(x<w-1)wr[i]=Math.exp(-beta*diff(i*4,(i+1)*4));if(y<h-1)wd[i]=Math.exp(-beta*diff(i*4,(i+w)*4));}
  const un=[];for(let i=0;i<tri.length;i++)if(tri[i]===-1)un.push(i);
  let next=new Float32Array(prob);
  for(let it=0;it<iterations;it++){
    for(const i of un){const x=i%w;let num=unary[i]*(1/smooth),den=1/smooth;
      if(x>0){const wt=wr[i-1];num+=wt*prob[i-1];den+=wt;}if(x<w-1){const wt=wr[i];num+=wt*prob[i+1];den+=wt;}
      if(i>=w){const wt=wd[i-w];num+=wt*prob[i-w];den+=wt;}if(i<w*h-w){const wt=wd[i];num+=wt*prob[i+w];den+=wt;}
      next[i]=num/den;}
    const t=prob;prob=next;next=t;}
  // soft alpha: a short ramp around 0.5 keeps natural edges instead of a hard staircase
  const alpha=new Uint8Array(w*h);let area=0,inter=0,union=0,minX=w,minY=h,maxX=-1,maxY=-1;
  for(let i=0;i<alpha.length;i++){const a=Math.min(1,Math.max(0,(prob[i]-0.35)/0.3));alpha[i]=Math.round(a*255);
    const inFg=a>=0.5;if(inFg){area++;const x=i%w,y=(i-x)/w;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
    if(inFg&&coarse[i])inter++;if(inFg||coarse[i])union++;}
  return {alpha,width:w,height:h,
    bbox:maxX<0?null:[minX/w,minY/h,(maxX+1)/w,(maxY+1)/h],
    stats:{subjectPixels:area,polygonPixels:coarseCount,unknownPixels:nUn,bandPixels:B,agreementWithOutline:union?inter/union:0,separability,
      colourGap:Math.round(colourGap),
      // honest about hard cases: similar colors or overlapping color sets mean the edge is a guess
      confidence:(separability<0.25||colourGap<25)?'low':(separability>=0.4&&colourGap>=60)?'high':'medium'}};
}
// Applies a mask to the picture: returns new RGBA bytes with the mask as the alpha channel.
export function applyMask({data,width,height},alpha){if(alpha.length!==width*height)throw fail('Mask size does not match the picture.');const out=new Uint8ClampedArray(data);for(let i=0;i<alpha.length;i++)out[i*4+3]=Math.round(out[i*4+3]*alpha[i]/255);return out;}
