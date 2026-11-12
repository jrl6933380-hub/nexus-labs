#!/usr/bin/env node
// On-demand Qwen. This process owns 127.0.0.1:9931 (the address every Ally script already uses) and runs the real
// llama-server on 127.0.0.1:9932 only while it is needed. Nothing else changes for callers.
//  - /health and /v1/models are answered without waking him (models comes from a saved copy while he sleeps).
//  - Any other request wakes him, waits until he is ready, then passes the request through.
//  - He is stopped after IDLE_MS with no requests, when his private memory passes CEILING_MB (never mid-request),
//    and after MAX_UPTIME_MS, so his memory can never swell for days again.
// Local only: no network except the two loopback ports. Nothing is sent, published or executed from request data.
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const FRONT_PORT=9931,BACK_PORT=9932;
export const IDLE_MS=10*60*1000,CEILING_MB=9000,MAX_UPTIME_MS=6*3600*1000,WAKE_TIMEOUT_MS=180000,TICK_MS=30000;
export const llamaArgs=(port=BACK_PORT)=>['-hf','SoAIHQ/Qwen3.5-9B-GGUF:Q4_K_M','-c','4096','-ngl','0','-np','1','--no-mmproj-offload','--reasoning-budget','128','--host','127.0.0.1','--port',String(port)];
const FALLBACK_MODEL='SoAIHQ/Qwen3.5-9B-GGUF:Q4_K_M';
const json=(res,code,body)=>{const text=JSON.stringify(body);res.writeHead(code,{'content-type':'application/json','content-length':Buffer.byteLength(text)});res.end(text);};

export function createManager({exe,spawnImpl=spawn,fetchImpl=fetch,now=()=>Date.now(),memoryMb=async()=>0,modelFile=null,log=()=>{},
 idleMs=IDLE_MS,ceilingMb=CEILING_MB,maxUptimeMs=MAX_UPTIME_MS,wakeTimeoutMs=WAKE_TIMEOUT_MS,backPort=BACK_PORT,pollMs=1000}={}){
 let child=null,ready=false,starting=null,inflight=0,lastUse=now(),startedAt=0,model='';
 const base=`http://127.0.0.1:${backPort}`;
 const state=()=>({running:Boolean(child),ready,inflight,idleFor:Math.round((now()-lastUse)/1000),model});
 async function loadModel(){if(model||!modelFile)return;try{model=String(JSON.parse(await readFile(modelFile,'utf8')).id||'').slice(0,200);}catch{}}
 async function saveModel(id){if(!id||id===model)return;model=id;if(modelFile)try{await writeFile(modelFile,JSON.stringify({id}));}catch{}}
 async function healthy(){try{const r=await fetchImpl(base+'/health',{signal:AbortSignal.timeout(2500)});return r.ok;}catch{return false;}}
 async function start(){
  log('waking Qwen');
  child=spawnImpl(exe,llamaArgs(backPort),{windowsHide:true,stdio:'ignore'});
  const mine=child;startedAt=now();ready=false;
  mine.on?.('exit',()=>{if(child===mine){child=null;ready=false;log('Qwen exited');}});
  const deadline=now()+wakeTimeoutMs;
  while(now()<deadline){
   if(child!==mine)throw Error('Qwen stopped while starting.');
   if(await healthy()){ready=true;log('Qwen ready');return;}
   await new Promise(r=>setTimeout(r,pollMs));
  }
  stopNow('did not become ready');throw Error('Qwen did not become ready in time.');
 }
 function ensure(){
  if(child&&ready)return Promise.resolve();
  if(!starting)starting=start().finally(()=>{starting=null;});
  return starting;
 }
 function stopNow(why){
  log('stopping Qwen: '+why);
  const c=child;child=null;ready=false;
  try{c?.kill();}catch{}
 }
 async function tick(){
  if(!child||!ready||inflight>0)return state();
  if(now()-lastUse>idleMs)stopNow('idle');
  else if(now()-startedAt>maxUptimeMs)stopNow('refresh after long uptime');
  else{
   let mb=0;try{mb=await memoryMb(child.pid);}catch{}
   if(inflight===0&&child&&mb>ceilingMb)stopNow(`memory ${Math.round(mb)} MB over ${ceilingMb} MB`);
  }
  return state();
 }
 async function handle(req,res){
  const path=String(req.url||'/').split('?')[0];
  try{
   if(req.method==='GET'&&path==='/health')return json(res,200,{status:'ok',sleeping:!ready,manager:true});
   if(req.method==='GET'&&path==='/v1/models'&&!ready){
    await loadModel();
    return json(res,200,{object:'list',data:[{id:model||FALLBACK_MODEL,object:'model'}]});
   }
   inflight++;lastUse=now();
   let proxied=false;
   try{
    await ensure();
    await new Promise((resolveDone,reject)=>{
     const up=http.request({host:'127.0.0.1',port:backPort,path:req.url,method:req.method,headers:req.headers},r=>{
      proxied=true;
      if(path==='/v1/models'){
       const chunks=[];r.on('data',c=>chunks.push(c));
       r.on('end',()=>{const text=Buffer.concat(chunks);try{saveModel(JSON.parse(text.toString()).data?.[0]?.id);}catch{}res.writeHead(r.statusCode||502,r.headers);res.end(text);resolveDone();});
       return;
      }
      res.writeHead(r.statusCode||502,r.headers);r.pipe(res);r.on('end',resolveDone);r.on('error',reject);
     });
     up.on('error',reject);
     req.on('aborted',()=>up.destroy());res.on('close',()=>{up.destroy();resolveDone();});
     req.pipe(up);
    });
   }finally{inflight--;lastUse=now();}
  }catch(e){
   if(!res.headersSent)json(res,503,{error:{message:String(e?.message||e).slice(0,160)}});else res.end();
  }
 }
 return {handle,tick,ensure,stop:()=>stopNow('manager stopping'),state};
}

const psMemory=pid=>new Promise((ok,no)=>execFile('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${Number(pid)}).PrivateMemorySize64/1MB`],{timeout:8000,windowsHide:true},(e,out)=>e?no(e):ok(Number(String(out).trim())||0)));

export function main(env=process.env){
 const home=env.LOCALAPPDATA||process.cwd();
 const exe=env.LLAMA_SERVER_EXE||join(env.USERPROFILE||'.','Downloads','llama-b11960-bin-win-vulkan-x64','llama-server.exe');
 const m=createManager({exe,memoryMb:psMemory,modelFile:join(home,'NexusAlly','qwen-manager-model.json'),log:s=>console.log(new Date().toISOString()+' '+s)});
 const server=http.createServer((req,res)=>{m.handle(req,res);});
 server.listen(FRONT_PORT,'127.0.0.1',()=>console.log('QWEN_MANAGER_READY port '+FRONT_PORT));
 const timer=setInterval(()=>{m.tick().catch(()=>{});},TICK_MS);
 const bye=()=>{clearInterval(timer);m.stop();server.close();process.exit(0);};
 process.on('SIGINT',bye);process.on('SIGTERM',bye);process.on('exit',()=>m.stop());
 return {server,manager:m};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
