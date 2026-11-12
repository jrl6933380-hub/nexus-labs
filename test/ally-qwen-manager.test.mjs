import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createManager,llamaArgs} from '../scripts/ally/qwen-manager.mjs';

const BACK=19932;
function rig(opts={}){
 let clock=1000,spawned=0,killed=0,fake=null,mem=0;
 const spawnImpl=()=>{
  spawned++;
  const handlers={};
  fake=http.createServer((req,res)=>{
   if(req.url==='/health'){res.writeHead(200);return res.end('{"status":"ok"}');}
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'real-model'}]}));}
   let body='';req.on('data',c=>body+=c);req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({echo:body,slow:req.headers['x-slow']==='1'}));});
  }).listen(BACK,'127.0.0.1');
  return {pid:4242,on:(e,f)=>{handlers[e]=f;},kill:()=>{killed++;fake?.close();fake?.closeAllConnections?.();handlers.exit?.();}};
 };
 const m=createManager({exe:'x',spawnImpl,now:()=>clock,memoryMb:async()=>mem,backPort:BACK,pollMs:20,wakeTimeoutMs:5000,idleMs:600000,ceilingMb:9000,...opts});
 const front=http.createServer((q,r)=>m.handle(q,r));
 return {m,front,advance:ms=>{clock+=ms;},setMem:v=>{mem=v;},counts:()=>({spawned,killed}),
  async listen(){await new Promise(r=>front.listen(0,'127.0.0.1',r));this.port=front.address().port;},
  async close(){m.stop();front.close();front.closeAllConnections?.();await new Promise(r=>setTimeout(r,30));},
  get:p=>fetch(`http://127.0.0.1:${front.address().port}${p}`).then(async r=>({status:r.status,body:await r.json()})),
  post:(p,b,h={})=>fetch(`http://127.0.0.1:${front.address().port}${p}`,{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}))};
}

test('launch settings keep the same model and limits, on the private back port',()=>{
 const a=llamaArgs(9932);
 assert.ok(a.includes('SoAIHQ/Qwen3.5-9B-GGUF:Q4_K_M'));assert.equal(a[a.indexOf('-c')+1],'4096');assert.equal(a[a.indexOf('-ngl')+1],'0');
 assert.equal(a[a.indexOf('--host')+1],'127.0.0.1');assert.equal(a[a.indexOf('--port')+1],'9932');
});
test('health and models answer while he sleeps without waking him',async()=>{
 const r=rig();await r.listen();
 try{
  const h=await r.get('/health');assert.equal(h.status,200);assert.equal(h.body.status,'ok');assert.equal(h.body.sleeping,true);
  const m=await r.get('/v1/models');assert.equal(m.status,200);assert.ok(m.body.data[0].id);
  assert.equal(r.counts().spawned,0);
 }finally{await r.close();}
});
test('a real request wakes him once, is passed through, and later requests reuse him',async()=>{
 const r=rig();await r.listen();
 try{
  const a=await r.post('/v1/chat/completions',{hi:1});assert.equal(a.status,200);assert.match(a.body.echo,/"hi":1/);
  const b=await r.post('/v1/chat/completions',{hi:2});assert.equal(b.status,200);
  assert.equal(r.counts().spawned,1);
  assert.equal((await r.get('/health')).body.sleeping,false);
 }finally{await r.close();}
});
test('he is stopped after idle time, and woken again by the next request',async()=>{
 const r=rig();await r.listen();
 try{
  await r.post('/v1/chat/completions',{a:1});
  r.advance(300000);await r.m.tick();assert.equal(r.counts().killed,0);
  r.advance(400000);await r.m.tick();assert.equal(r.counts().killed,1);
  await r.post('/v1/chat/completions',{a:2});assert.equal(r.counts().spawned,2);
 }finally{await r.close();}
});
test('memory over the ceiling restarts him, but never while a request is running',async()=>{
 const r=rig();await r.listen();
 try{
  await r.post('/v1/chat/completions',{a:1});
  r.setMem(8000);await r.m.tick();assert.equal(r.counts().killed,0);
  r.setMem(16000);await r.m.tick();assert.equal(r.counts().killed,1);
  await r.post('/v1/chat/completions',{a:2});
  r.m.state();r.setMem(16000);
  const s=r.m.state();assert.equal(s.inflight,0);
 }finally{await r.close();}
});
test('if he cannot start, callers get a clear 503 instead of hanging',async()=>{
 const r=rig({spawnImpl:()=>({pid:1,on(){},kill(){}}),wakeTimeoutMs:150,now:()=>Date.now()});await r.listen();
 try{const a=await r.post('/v1/chat/completions',{a:1});assert.equal(a.status,503);assert.match(a.body.error.message,/did not become ready/);}
 finally{await r.close();}
});
