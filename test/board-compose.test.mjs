import test from 'node:test';
import assert from 'node:assert/strict';
import {outputSize,coverRect,foregroundRect,MAX_COMPOSE_PIXELS} from '../public/board-compose-core.js';
test('background covers each output without stretching; foreground keeps its proportions',()=>{
  assert.deepEqual(coverRect(200,100,100,100),{x:-50,y:0,w:200,h:100});
  const fg=foregroundRect(80,40,100,100,{x:.75,y:.25,scale:1});
  assert.deepEqual(fg,{x:25,y:0,w:100,h:50});
});
test('large outputs stay within the phone memory cap',()=>{
  for(const [w,h] of [[10000,10000],[8000,12000],[1,9000000]]){
    const out=outputSize(w,h);assert.ok(out.width*out.height<=MAX_COMPOSE_PIXELS);
  }
  assert.deepEqual(outputSize(1080,1920),{width:1080,height:1920});
  for(const n of [NaN,Infinity,0,-1])assert.throws(()=>outputSize(n,100));
});
