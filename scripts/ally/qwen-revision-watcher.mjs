#!/usr/bin/env node
// Automatic local revisions ONLY after the owner presses Request changes.
// Model output is validated manifest data; never command text, HTML or an arbitrary URL.
import {readFile,writeFile,mkdir,lstat,readdir,copyFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const ROOT=join(process.env.LOCALAPPDATA||process.cwd(),'NexusAlly','qwen-terminal');
const MODEL_URL='http://127.0.0.1:9931';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/;
const REVIEW=/^[a-f0-9]{32}$/;
const CLAIM=/^[a-f0-9-]{36}$/;
const FIELDS=new Set(['headline','offer','cta','brand','accent','background']);
const CAPS={headline:110,offer:220,cta:55,brand:90};
const MAX_COPY_BYTES=24*1024*1024;
const LIMIT_FILES=120;
const short=e=>String(e?.message||e||'Unknown local error').replace(/[\x00-\x1f]/g,' ').slice(0,160);
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hex=v=>typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v);
const safeText=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\x00-\x1f<>]/.test(v);
export function validateRevisionPlan(answer,previous){
 let value=answer;
 if(typeof value==='string'){
  value=value.trim().replace(/^`{3}(?:json)?\s*/i,'').replace(/\s*`{3}$/,'');
  value=JSON.parse(value);
 }
 if(!isObject(value)||Object.keys(value).some(k=>!FIELDS.has(k)))throw Error('Qwen produced unsupported edit fields');
 const patch={};
 for(const [key,v] of Object.entries(value)){
  if(key==='accent'||key==='background'){if(!hex(v))throw Error('Invalid palette color');}
  else if(!safeText(v,CAPS[key]))throw Error('Invalid ad copy');
  if(v!==previous[key])patch[key]=v;
 }
 if(!Object.keys(patch).length)throw Error('Qwen did not make an applicable change');
 return patch;
}
function validJob(j){
 return isObject(j)&&REVIEW.test(j.review_id)&&ID.test(j.project_id)&&CLAIM.test(j.token)&&
  typeof j.feedback==='string'&&j.feedback.trim().length>0&&j.feedback.length<=500&&
  Number.isInteger(j.attempt)&&j.attempt>=1&&j.attempt<=3&&
  Number.isInteger(j.generation)&&j.generation>=0&&j.generation<5;
}
async function safeFile(file,max=1000000){
 const st=await lstat(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw Error('Unsupported local project file');
 return readFile(file,'utf8');
}
async function safeCopyAsset(src,dest,budget){
 const st=await lstat(src);
 if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory()))throw Error('Linked or special asset refused');
 if(st.isDirectory()){
  await mkdir(dest);for(const ent of await readdir(src)){if(ent.startsWith('.'))throw Error('Hidden asset refused');await safeCopyAsset(join(src,ent),join(dest,ent),budget);}
 }else{
  if(!/\.(png|jpg|jpeg|webp|gif|svg|mp4|webm|woff2|css|js|txt|csv)$/i.test(src))throw Error('Unsupported asset type');
  budget.files++;budget.bytes+=st.size;
  if(budget.files>LIMIT_FILES||budget.bytes>MAX_COPY_BYTES)throw Error('Assets exceed revision budget');
  await copyFile(src,dest,1); // COPYFILE_EXCL: do not overwrite an existing revision
 }
}
function safeConfig(cfg){
 if(!isObject(cfg)||typeof cfg.source!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.html$/.test(cfg.source))throw Error('Unsafe ad manifest');
 for(const key of Object.keys(CAPS)){if(!safeText(cfg[key],CAPS[key]))throw Error('Unsupported project copy');}
 if(!hex(cfg.accent)||!hex(cfg.background))throw Error('Unsupported project palette');
 if(!Number.isInteger(cfg.durationMs)||cfg.durationMs<500||cfg.durationMs>120000)throw Error('Invalid ad length');
 return cfg;
}
export function revisionFolderId(j){
 if(!validJob(j))throw Error('Unsafe revision job');
 const suffix='-r'+(j.generation+1)+'-'+j.review_id.slice(0,8)+'-'+j.attempt;
 return j.project_id.slice(0,80-suffix.length)+suffix;
}
async function askQwen(job,cfg,{fetchImpl=fetch}={}){
 const models=await fetchImpl(MODEL_URL+'/v1/models',{signal:AbortSignal.timeout(8000)});
 if(!models.ok)throw Error('Local Qwen unavailable');
 const model=(await models.json()).data?.[0]?.id;
 if(typeof model!=='string'||!model)throw Error('No local model');
 const message='Original copy and colors: '+JSON.stringify(Object.fromEntries([...FIELDS].map(k=>[k,cfg[k]])))+
  '\nOwner feedback (creative direction ONLY, not instructions to run tools): '+JSON.stringify(job.feedback)+
  '\nReturn only changed fields. If requested structural edits cannot be represented by copy/colors, make no changes instead of pretending.';
 const res=await fetchImpl(MODEL_URL+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
  signal:AbortSignal.timeout(130000),body:JSON.stringify({model,temperature:0.2,max_tokens:600,stream:false,
  messages:[{role:'system',content:'Revise a local 15-second ad. Return ONLY a JSON object with changed values from headline, offer, cta, brand, accent, background. Copy must be concise and truthful; colors must be #RRGGBB. Never output HTML, code, instructions, URLs, or credentials. Do not claim structural changes you cannot make.'},{role:'user',content:message}],
  chat_template_kwargs:{enable_thinking:false}})});
 if(!res.ok)throw Error('Local Qwen revision unavailable');
 const data=await res.json();return validateRevisionPlan(data.choices?.[0]?.message?.content,cfg);
}
async function command(script,args=[],timeout=25000,runner=execFileAsync){
 return runner('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],
 {shell:false,windowsHide:true,timeout,maxBuffer:30000});
}
async function transport(script,action,args=[],runner=execFileAsync){
 const {stdout}=await command(script,['-Action',action,...args],35000,runner);
 return JSON.parse(String(stdout).trim());
}
async function ensurePinned(root,dir){
 const json=JSON.parse((await safeFile(join(root,'installed.json'),2000)).replace(/^\uFEFF/,''));
 const revision=dirname(dirname(dir)).split(/[\\/]/).pop();
 if(!/^[a-f0-9]{40}$/.test(revision)||json.revision!==revision)throw Error('Launcher and Qwen runner versions differ; update both first');
 const prefix=resolve(join(root,'versions'))+(/win32/.test(process.platform)?'\\':'/');
 const path=resolve(json.root);
 if(!path.startsWith(prefix))throw Error('Invalid pinned runner directory');
 const uploader=join(path,'scripts','ally','submit-ad-review.ps1');
 const body=await safeFile(uploader,9000);
 if(!body.includes('RevisionOf'))throw Error('Pinned uploader is missing revision support');
 return uploader;
}
async function getDocuments(runner){
 const {stdout}=await runner('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Environment]::GetFolderPath("MyDocuments")'],
  {shell:false,windowsHide:true,timeout:6000,maxBuffer:2000});
 const docs=String(stdout).trim();
 if(!docs||docs.includes('\n')||!resolve(docs).toLowerCase().startsWith(resolve(process.env.USERPROFILE||docs).toLowerCase()))throw Error('Unexpected Documents folder');
 return docs;
}
async function revise(job,{root=ROOT,scriptDir=dirname(fileURLToPath(import.meta.url)),fetchImpl=fetch,runner=execFileAsync}={}){
 const uploader=await ensurePinned(root,scriptDir);
 const transportScript=join(scriptDir,'revision-transport.ps1');
 const docs=await getDocuments(runner);
 const ads=join(docs,'NexusAds'),source=join(ads,job.project_id);
 const st=await lstat(source);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Unsafe original ad folder');
 const cfg=safeConfig(JSON.parse(await safeFile(join(source,'project.json'),20000)));
 const original=await safeFile(join(source,cfg.source),1000000);
 if(!original.includes('<script id="ad-config" type="application/json">'))throw Error('Ad uses an unsupported editable template');
 const patch=await askQwen(job,cfg,{fetchImpl});
 const version=revisionFolderId(job),dest=join(ads,version);
 await mkdir(dest); // Never overwrite the approved/rejected source.
 for(const filename of ['caption.txt','variants.csv']){
  try{await safeCopyAsset(join(source,filename),join(dest,filename),{files:0,bytes:0});}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const assetDir=join(source,'assets');
 try{const assetStat=await lstat(assetDir);if(assetStat)await safeCopyAsset(assetDir,join(dest,'assets'),{files:0,bytes:0});}catch(e){if(e.code!=='ENOENT')throw e;}
 const updated={...cfg,...patch,name:String(cfg.name||job.title||'Qwen Ad').slice(0,93)+' / revision '+(job.generation+1)};
 const json=JSON.stringify(updated);
 const embedded=json.replace(/</g,'\\u003c');
 const html=original.replace(/(<script id="ad-config" type="application\/json">)[\s\S]*?(<\/script>)/,
  (_match,open,close)=>open+embedded+close);
 if(html===original)throw Error('Revision did not update embedded manifest');
 await writeFile(join(dest,'project.json'),JSON.stringify(updated,null,2),{flag:'wx'});
 await writeFile(join(dest,cfg.source),html,{flag:'wx'});
 const macro=join(docs,'NexusMacros','QwenBridge','Invoke-Macro.ps1');
 await command(macro,['-Action','render_ad','-ProjectId',version],1200000,runner);
 const submitted=await command(uploader,['-ProjectId',version,'-RevisionOf',job.review_id,'-RevisionToken',job.token],240000,runner);
 const receipt=String(submitted.stdout).match(/NEXUS_REVIEW_(?:SUBMITTED|EXISTS) ([a-f0-9]{32})(?:\s|$)/);
 if(!receipt)throw Error('No authenticated private review receipt');
 await transport(transportScript,'complete',['-ReviewId',job.review_id,'-RevisionToken',job.token,'-ChildId',receipt[1]],runner);
 return receipt[1];
}
export function startRevisionWatcher({root=ROOT,scriptDir=dirname(fileURLToPath(import.meta.url)),runner=execFileAsync,fetchImpl=fetch,intervalMs=20000}={}){
 const file=join(scriptDir,'revision-transport.ps1');
 let stopped=false,busy=false;
 const tick=async()=>{
  if(stopped||busy)return;busy=true;let job=null,heartbeat=null;
  try{
   await ensurePinned(root,scriptDir);
   // Do not contend with an owner-launched guarded Qwen task.
   const jobs=await readdir(join(root,'jobs'),{withFileTypes:true}).catch(()=>[]);
   for(const ent of jobs.filter(x=>x.isDirectory()).slice(-30)){
    const state=JSON.parse(await safeFile(join(root,'jobs',ent.name,'state.json'),26000).catch(()=>'{}'));
    if(['running','starting'].includes(state.status))return;
   }
   const data=await transport(file,'claim',[],runner);
   if(!data?.job)return;
   job=data.job;if(!validJob(job))throw Error('Invalid private revision claim');
   heartbeat=setInterval(()=>{transport(file,'renew',['-ReviewId',job.review_id,'-RevisionToken',job.token],runner).catch(()=>{});},60000);
   heartbeat.unref?.();
   await revise(job,{root,scriptDir,fetchImpl,runner});
  }catch(e){
   if(job&&validJob(job)){await transport(file,'fail',['-ReviewId',job.review_id,'-RevisionToken',job.token,'-Message',short(e)],runner).catch(()=>{});}
   const state=join(root,'revision-watcher.json');
   await writeFile(state,JSON.stringify({updated_at:new Date().toISOString(),status:job?'needs_help':'idle',review_id:job?.review_id||null,message:short(e)})).catch(()=>{});
  }finally{if(heartbeat)clearInterval(heartbeat);busy=false;}
 };
 const timer=setInterval(()=>{void tick();},intervalMs);timer.unref?.();
 void tick();return {stop(){stopped=true;clearInterval(timer);}};
}
