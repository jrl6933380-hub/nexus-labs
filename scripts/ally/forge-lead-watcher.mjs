#!/usr/bin/env node
// Owner-approved, device-bound runner for Forge lead jobs. Runs only the two installed, pinned local macros:
// forge-leads.mjs (visible Google AI Mode + Maps search) and forge-preview.mjs (deterministic previews + pitch).
// Job fields are validated data; nothing from the web or a model is ever executed. Nothing is sent or published.
import {readFile,writeFile,lstat,readdir,mkdir,rm} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const ID=/^[a-f0-9]{32}$/,CLAIM=/^[a-f0-9-]{36}$/,BATCH=/^batch-[0-9a-f-]{8,64}$/;
const TEXT=/^[\p{L}\p{N} .,'&-]{2,100}$/u;
const MAX_FILE=70000,MAX_HTML_PACKS=5;
const failure=e=>/Bearer|Command failed|powershell\.exe|ClaimToken/i.test(String(e?.message||e))
 ?'Local macro failed; look at the Ally.':String(e?.message||e).replace(/[\x00-\x1f]/g,' ').slice(0,160);

export function validJob(j){
 if(!j||!ID.test(j.id)||!CLAIM.test(j.token))return false;
 if(j.kind==='search')return TEXT.test(j.business||'')&&TEXT.test(j.city||'')&&Number.isInteger(j.count)&&j.count>=1&&j.count<=10;
 if(j.kind==='build'){
  const picks=j.picks==='eligible'||(Array.isArray(j.picks)&&j.picks.length>=1&&j.picks.length<=10&&j.picks.every(n=>Number.isInteger(n)&&n>=1&&n<=10));
  return BATCH.test(j.batch||'')&&picks&&typeof j.offer==='boolean';
 }
 return false;
}
export function batchDir(stdout,batchesRoot){
 const line=String(stdout).split(/\r?\n/).map(s=>s.trim()).find(s=>s.startsWith('BATCH '));
 if(!line)throw Error('Search printed no batch folder');
 const dir=resolve(line.slice(6).trim());
 if(dirname(dir).toLowerCase()!==resolve(batchesRoot).toLowerCase()||!BATCH.test(dir.split(sep).pop()))throw Error('Unexpected batch folder');
 return dir;
}
export function searchResult(batchName,batch){
 if(batch?.status!=='ready_for_review')throw Error(batch?.error?'Search stopped: '+String(batch.error).slice(0,120):'Search did not finish. Look at the Ally screen.');
 return {batch:batchName,leads:(batch.candidates||[]).slice(0,10).map(c=>({name:c.name,status:c.status,duplicate:c.duplicate===true,
  phone:c.phone_suggestion||'',notes:c.notes||''}))};
}
export function previewReceipt(stdout,previewsRoot){
 const m=String(stdout).match(/FORGE_PREVIEW_READY leads=(\d+) files=(\d+) dir=(.+)/);
 if(!m)throw Error('Preview receipt missing');
 const dir=resolve(m[3].trim());
 if(dirname(dir).toLowerCase()!==resolve(previewsRoot).toLowerCase())throw Error('Unexpected preview folder');
 return {leads:Number(m[1]),dir};
}
async function safeText(path,max){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw Error('Unsafe local file');
 return readFile(path,'utf8');
}
export async function packResult(batch,dir){
 const pack=JSON.parse((await safeText(join(dir,'pack.json'),200000)).replace(/^﻿/,''));
 const packs=[];
 for(const [i,lead] of (pack.leads||[]).slice(0,10).entries()){
  if(!/^\d\d-[a-z0-9-]{0,40}$/.test(lead.folder||''))throw Error('Unexpected lead folder');
  const folder=join(dir,lead.folder);
  const entry={name:lead.name,pitch:await safeText(join(folder,'pitch.txt'),20000),previews:{}};
  if(i<MAX_HTML_PACKS)for(const k of ['editorial','bold','fresh']){
   try{entry.previews[k]=await safeText(join(folder,k+'.html'),MAX_FILE);}catch{}
  }
  packs.push(entry);
 }
 if(!packs.length)throw Error('Build made no packs');
 return {batch,packs};
}
async function nodeAndTools(appRoot){
 const node=join(appRoot,'runtime','node.exe');
 await lstat(node);
 const lead=JSON.parse((await safeText(join(appRoot,'forge-leads','installed.json'),4000)).replace(/^﻿/,''));
 const preview=JSON.parse((await safeText(join(appRoot,'forge-leads','preview-installed.json'),4000)).replace(/^﻿/,''));
 const under=(p,parent)=>resolve(p).toLowerCase().startsWith((resolve(parent)+sep).toLowerCase());
 const leadScript=join(resolve(lead.root),'forge-leads.mjs'),previewScript=resolve(preview.worker);
 if(!under(leadScript,join(appRoot,'forge-leads','versions'))||!under(previewScript,join(appRoot,'forge-leads','preview-versions')))
  throw Error('Installed lead macros are not where they should be');
 await lstat(leadScript);await lstat(previewScript);
 return {node,leadScript,previewScript};
}
async function ps(script,action,args,runner){
 const {stdout}=await runner('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action',action,...args],
  {shell:false,windowsHide:true,timeout:60000,maxBuffer:24000});
 return JSON.parse(String(stdout).replace(/^﻿/,'').trim());
}
async function manualTaskRunning(root){
 let rows=[];try{rows=await readdir(join(root,'jobs'),{withFileTypes:true});}catch{return false;}
 for(const row of rows.slice(-120)){
  if(!row.isDirectory()||!/^[0-9a-f-]{36}$/i.test(row.name))continue;
  try{const s=JSON.parse(await safeText(join(root,'jobs',row.name,'state.json'),26000));
   if(!['done','needs_help','needs_approval','failed','canceled'].includes(s.status))return true;}catch{}
 }
 return false;
}
export async function runLeadJob(job,{root,scriptDir=dirname(fileURLToPath(import.meta.url)),runner=exec}={}){
 if(!validJob(job))throw Error('Invalid paired-device job');
 const appRoot=resolve(root,'..'),transport=join(scriptDir,'forge-lead-transport.ps1');
 const tools=await nodeAndTools(appRoot);
 const batchesRoot=join(appRoot,'forge-leads','batches'),previewsRoot=join(appRoot,'forge-leads','previews');
 let stage='claimed',stop=false,lease=false,misses=0,pending=Promise.resolve();
 const beat=next=>{stage=next;pending=pending.catch(()=>{}).then(async()=>{
  const r=await ps(transport,'heartbeat',['-JobId',job.id,'-ClaimToken',job.token,'-Stage',next],runner);
  if(r?.result?.cancel_requested)stop=true;});return pending;};
 const check=()=>{if(lease)throw Error('Lease renewal failed; look at the Ally');if(stop)throw Error('Owner requested stop');};
 await beat('claimed');
 // A single slow or dropped heartbeat (the Ally is busy with Qwen/browser) must not fail a good search.
 // The server lease is 30 min and beats run every 45 s, so three misses in a row is a real problem.
 const timer=setInterval(()=>void beat(stage).then(()=>{misses=0;}).catch(()=>{if(++misses>=3)lease=true;}),45000);timer.unref?.();
 try{
  let result;
  if(job.kind==='search'){
   await beat('searching');check();
   let out;
   try{out=(await runner(tools.node,[tools.leadScript,'--business',job.business,'--city',job.city,'--count',String(job.count)],
    {shell:false,windowsHide:true,timeout:1500000,maxBuffer:200000})).stdout;}
   catch(e){out=e.stdout||'';if(!out)throw Error('Search could not start. Is Local Qwen running?');}
   check();
   const dir=batchDir(out,batchesRoot),name=dir.split(sep).pop();
   result=searchResult(name,JSON.parse((await safeText(join(dir,'batch.json'),1000000)).replace(/^﻿/,'')));
  }else{
   await beat('building');check();
   const args=[tools.previewScript,'--batch',job.batch,'--pick',job.picks==='eligible'?'eligible':job.picks.join(',')];
   if(job.offer)args.push('--launch-offer');
   const {stdout}=await runner(tools.node,args,{shell:false,windowsHide:true,timeout:120000,maxBuffer:50000});
   check();
   const receipt=previewReceipt(stdout,previewsRoot);
   result=await packResult(job.batch,receipt.dir);
  }
  await beat('uploading');check();
  const out=join(appRoot,'forge-lead-results');await mkdir(out,{recursive:true});
  const file=join(out,job.id+'.json');
  await writeFile(file,JSON.stringify(result),'utf8');
  try{await ps(transport,'complete',['-JobId',job.id,'-ClaimToken',job.token,'-ResultFile',file],runner);}
  finally{await rm(file,{force:true}).catch(()=>{});}
  return {id:job.id,kind:job.kind};
 }finally{clearInterval(timer);}
}
export function startForgeLeadWatcher({root,scriptDir=dirname(fileURLToPath(import.meta.url)),runner=exec,intervalMs=30000}={}){
 let busy=false,stopped=false;
 const transport=join(scriptDir,'forge-lead-transport.ps1'),status=join(resolve(root,'..'),'forge-lead-worker-status.json');
 const note=(job,state,message='')=>writeFile(status,JSON.stringify({id:job?.id||null,status:state,updated_at:new Date().toISOString(),message}),'utf8').catch(()=>{});
 const tick=async()=>{
  if(stopped||busy)return;busy=true;let job=null;
  try{
   if(await manualTaskRunning(root))return;
   job=(await ps(transport,'claim',[],runner))?.job||null;
   if(!job)return;
   if(!validJob(job))throw Error('Invalid job');
   await runLeadJob(job,{root,scriptDir,runner});
   await note(job,'done');
  }catch(e){
   await note(job,job?'needs_attention':'idle',failure(e));
   if(job&&validJob(job))await ps(transport,'fail',['-JobId',job.id,'-ClaimToken',job.token,'-Message',failure(e)],runner).catch(()=>{});
  }finally{busy=false;}
 };
 const timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick();
 return {stop(){stopped=true;clearInterval(timer);}};
}
