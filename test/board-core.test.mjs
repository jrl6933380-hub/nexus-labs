import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVisualDocument,VISUAL_CSP,zoomAt,screenToWorld,fitView,addPoint,strokePath,lassoPolygon,inRect,clamp,ZOOM_MIN,ZOOM_MAX} from '../public/board-core.js';
import {segmentSubject} from '../public/nexus-lab-segment.js';

test('inline visuals run under a locked-down policy with no network, storage or outside access',()=>{
  for(const rule of ["default-src 'none'","connect-src 'none'","frame-src 'none'","object-src 'none'","form-action 'none'","base-uri 'none'"])assert.ok(VISUAL_CSP.includes(rule),rule);
  assert.ok(!/unsafe-eval|https?:/.test(VISUAL_CSP));
  const doc=buildVisualDocument('<svg><circle r="3"/></svg>');
  assert.match(doc,/Content-Security-Policy/);assert.match(doc,/<svg><circle r="3"\/><\/svg><\/body>/);
  assert.match(buildVisualDocument(undefined),/<body><\/body>/);
});
test('zooming keeps the point under the finger fixed and stays inside the zoom limits',()=>{
  const view={x:30,y:-20,z:1},p={x:200,y:300},before=screenToWorld(view,p),next=zoomAt(view,p,1.8),after=screenToWorld(next,p);
  assert.ok(Math.abs(before.x-after.x)<1e-9&&Math.abs(before.y-after.y)<1e-9);assert.equal(next.z,1.8);
  assert.equal(zoomAt(view,p,1000).z,ZOOM_MAX);assert.equal(zoomAt(view,p,0.0001).z,ZOOM_MIN);
});
test('fit shows every item and handles an empty board',()=>{
  const size={w:390,h:800},items=[{x:-400,y:-100,w:300,h:200},{x:900,y:500,w:300,h:200}],v=fitView(items,size);
  for(const i of items)for(const [px,py] of [[i.x,i.y],[i.x+i.w,i.y+i.h]]){const sx=px*v.z+v.x,sy=py*v.z+v.y;assert.ok(sx>=0&&sx<=size.w&&sy>=0&&sy<=size.h,`${sx},${sy}`);}
  assert.equal(fitView([],size).z,1);
});
test('strokes drop near-duplicate points, round them, and draw dots and curves',()=>{
  const pts=[];assert.equal(addPoint(pts,[0,0]),true);assert.equal(addPoint(pts,[1,1]),false);assert.equal(addPoint(pts,[10.123,10.987]),true);
  assert.deepEqual(pts,[[0,0],[10.1,11]]);
  assert.match(strokePath([[3,4]]),/^M3 4l0\.01 0$/);assert.match(strokePath([[0,0],[10,10],[20,0],[30,10]]),/^M0 0Q10 10 15 5Q20 0 25 5L30 10$/);assert.equal(strokePath([]),'');
});
test('a lasso becomes at most 60 fractional points inside the picture',()=>{
  const lasso=Array.from({length:500},(_,i)=>[i*2-20,i%300]);const poly=lassoPolygon(lasso,800,600);
  assert.ok(poly.length<=60&&poly.length>=3);for(const [x,y] of poly)assert.ok(x>=0&&x<=1&&y>=0&&y<=1);
  assert.equal(clamp(5,0,3),3);assert.ok(inRect({x:5,y:5},{x:0,y:0,w:10,h:10})&&!inRect({x:11,y:5},{x:0,y:0,w:10,h:10}));
});
test('the Lab refiner accepts a Board lasso and cuts a red square out of a blue picture',()=>{
  const w=40,h=40,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,inside=x>=12&&x<28&&y>=12&&y<28;data[i]=inside?220:20;data[i+1]=inside?30:40;data[i+2]=inside?30:200;data[i+3]=255;}
  const lasso=[];for(let t=0;t<64;t++){const a=t/64*Math.PI*2;lasso.push([20+Math.cos(a)*11,20+Math.sin(a)*11]);}
  const result=segmentSubject({data,width:w,height:h},lassoPolygon(lasso,w,h));
  assert.equal(result.alpha[20*w+20],255);assert.equal(result.alpha[2*w+2],0);assert.ok(['high','medium','low'].includes(result.stats.confidence));
});
