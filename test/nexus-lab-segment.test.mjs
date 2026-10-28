import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentSubject,rasterizePolygon,applyMask} from '../lib/nexusLabSegment.js';

// Deterministic fake picture: a warm ellipse on a cool, slightly noisy background.
function scene({w=160,h=120,fg=[235,190,80],bg=[20,30,70],noise=10}={}){
  const data=new Uint8ClampedArray(w*h*4),truth=new Uint8Array(w*h);let seed=7;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,inside=((x-80)/42)**2+((y-60)/30)**2<=1;truth[i]=inside?1:0;const c=inside?fg:bg;
    for(let k=0;k<3;k++)data[i*4+k]=Math.max(0,Math.min(255,c[k]+(rnd()-.5)*2*noise));data[i*4+3]=255;}
  return {img:{data,width:w,height:h},truth};
}
const iou=(a,b)=>{let i=0,u=0;for(let k=0;k<a.length;k++){const x=a[k]>0,y=b[k]>0;if(x&&y)i++;if(x||y)u++;}return i/u;};
// a rough outline: a hexagon wobbling several pixels off the true ellipse
const rough=[[.30,.50],[.42,.22],[.62,.20],[.76,.46],[.66,.80],[.40,.78]];

test('rasterizing a rectangle fills the right pixels', () => {
  const m=rasterizePolygon([[.25,.25],[.75,.25],[.75,.75],[.25,.75]],20,20);
  let n=0;for(const v of m)n+=v;assert.equal(n,100);assert.equal(m[10*20+10],1);assert.equal(m[0],0);
});

test('refinement lands closer to the true shape than the rough outline does', () => {
  const {img,truth}=scene();const coarse=rasterizePolygon(rough,160,120);
  const r=segmentSubject(img,rough);
  const before=iou(coarse,truth),after=iou(r.alpha.map(a=>a>=128?1:0),truth);
  assert.ok(after>before+0.05,`expected improvement, before ${before.toFixed(3)} after ${after.toFixed(3)}`);
  assert.ok(after>0.93,`refined overlap too low: ${after.toFixed(3)}`);
  assert.equal(r.stats.confidence,'high');
});

test('refinement is deterministic', () => {
  const {img}=scene();assert.deepEqual(segmentSubject(img,rough).alpha,segmentSubject(img,rough).alpha);
});

test('edges are soft, not a hard staircase, and the bbox hugs the subject', () => {
  const {img}=scene();const r=segmentSubject(img,rough);let soft=0;for(const a of r.alpha)if(a>0&&a<255)soft++;
  assert.ok(soft>0);assert.ok(r.bbox[0]>0.2&&r.bbox[2]<0.8&&r.bbox[1]>0.2&&r.bbox[3]<0.8);
});

test('when subject and background look alike it says so instead of pretending', () => {
  const {img}=scene({fg:[60,70,100],bg:[55,65,95],noise:12});const r=segmentSubject(img,rough);
  assert.equal(r.stats.confidence,'low');
});

test('applyMask puts the mask in the alpha channel', () => {
  const {img}=scene();const r=segmentSubject(img,rough);const out=applyMask(img,r.alpha);
  assert.equal(out[(60*160+80)*4+3],255);assert.equal(out[3],0);
});

test('bad input is rejected with a plain message', () => {
  const {img}=scene();
  assert.throws(()=>segmentSubject(img,[[0,0],[1,1]]),/at least 3 points/);
  assert.throws(()=>segmentSubject(img,[[.1,.1],[.1,.1],[.1,.1]]),/covers no pixels|too small/);
  assert.throws(()=>segmentSubject({data:new Uint8ClampedArray(4),width:160,height:120},rough),/matching width/);
  assert.throws(()=>segmentSubject(img,[[0,0],[1,0],[1,1],[0,1]]),/too small|whole picture/);
});

test('a thin subject still works (a wide, short strip)', () => {
  const w=200,h=150,data=new Uint8ClampedArray(w*h*4),truth=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,inside=x>=30&&x<=180&&y>=70&&y<=84;truth[i]=inside?1:0;const c=inside?[240,200,90]:[15,20,50];data.set([...c,255],i*4);}
  const r=segmentSubject({data,width:w,height:h},[[.12,.45],[.93,.46],[.92,.58],[.14,.57]]);
  const mask=r.alpha.map(a=>a>=128?1:0);let i2=0,u=0;for(let k=0;k<mask.length;k++){if(mask[k]&&truth[k])i2++;if(mask[k]||truth[k])u++;}
  assert.ok(i2/u>0.9,`thin strip overlap ${(i2/u).toFixed(3)}`);
});

test('a hair-thin sliver degrades gracefully instead of crashing', () => {
  const {img}=scene();
  const r=segmentSubject(img,[[.2,.50],[.8,.50],[.8,.54],[.2,.54]]);
  assert.ok(r.alpha.length===160*120);
});
