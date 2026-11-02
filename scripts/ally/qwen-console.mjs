#!/usr/bin/env node
// Nexus Ally local control panel: loopback-only UI and bounded bridge to local Qwen.
// Never exposes a shell or directly executes user/model command text.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir,stat,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const HOST='127.0.0.1';
export const PORT=9942;
const ORIGIN=`http://${HOST}:${PORT}`;
const QWEN='http://127.0.0.1:9931';
const TERMINAL=new Set(['done','needs_help','needs_approval','failed','canceled']);
const MAX_BODY=12000;
const ROOT=join(process.env.LOCALAPPDATA||process.cwd(),'NexusAlly','qwen-terminal');
const PANEL=new URL('../../public/ally-qwen-console.html',import.meta.url);
const DECK=new URL('../../public/ally-launcher.html',import.meta.url);
const short=(str,n=200)=>String(str??'').slice(0,n);
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
export const validOrigin=(headers)=>headers.origin===ORIGIN && /^application\/json(?:;|$)/i.test(headers['content-type']||'') && headers['x-nexus-panel']==='1';
function reply(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'SAMEORIGIN'});res.end(JSON.stringify(body));}
function bad(res,status,message){reply(res,status,{error:message});}
async function bodyJson(req){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BODY)throw Object.assign(new Error('Request too large'),{status:413});chunks.push(chunk);}const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!v||typeof v!=='object'||Array.isArray(v))throw Error('JSON object required');return v;}
async function jsonFile(path){try{const f=await stat(path);if(!f.isFile()||f.size>26000)return null;return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
const jobDir=(root,id)=>join(root,'jobs',id);
function jobId(id){return typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);}
export async function listJobs(root=ROOT){const dir=join(root,'jobs');let entries=[];try{entries=await readdir(dir,{withFileTypes:true});}catch{return [];}const results=[];for(const e of entries.slice(-120)){if(!e.isDirectory()||!jobId(e.name))continue;const path=jobDir(root,e.name);const [state,request]=await Promise.all([jsonFile(join(path,'state.json')),jsonFile(join(path,'request.json'))]);const input=request||await jsonFile(join(path,'input.json'));const info=await stat(path).catch(()=>null);results.push({id:e.name,status:short(state?.status||'starting',30),step:state?.step||0,updatedAt:state?.updatedAt||info?.mtime?.toISOString()||null,task:short(input?.task,180),answer:short(state?.answer,400),error:short(state?.error,300),history:Array.isArray(state?.history)?state.history.slice(-6).map(h=>({step:h.step,tool:short(h.tool||'error',30),error:short(h.error,160),result:h.result?.error?short(h.result.error,160):null})):[]});}results.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));return results.slice(0,10);}
async function qwenStatus(fetchImpl=fetch){try{const r=await fetchImpl(`${QWEN}/health`,{signal:AbortSignal.timeout(2800)});if(!r.ok)return {online:false};const data=await r.json().catch(()=>({}));return {online:true,state:short(data.status||'ready',24)};}catch{return {online:false};}}
async function selectedModel(fetchImpl=fetch){const r=await fetchImpl(`${QWEN}/v1/models`,{signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('Local model unavailable');const j=await r.json();const model=j?.data?.[0]?.id;if(typeof model!=='string'||!model)throw Error('No local Qwen model');return model;}
export async function chat(input,{fetchImpl=fetch}={}){
 if(typeof input.message!=='string'||!input.message.trim()||input.message.length>1400)throw Error('Message must be 1–1400 characters');
 const history=Array.isArray(input.history)?input.history:[];
 if(history.length>12)throw Error('Conversation history too long');
 const prior=history.map(x=>{if(!x||!['user','assistant'].includes(x.role)||typeof x.content!=='string'||x.content.length>1400)throw Error('Invalid conversation');return {role:x.role,content:x.content};});
 const model=await selectedModel(fetchImpl);
 const messages=[{role:'system',content:'You are Qwen running locally on the owner’s ROG Ally in Nexus Console. Answer conversationally and briefly. This chat has no tools or terminal execution. If asked to work with files, advise using the separate guarded Task panel. Never claim to have run terminal commands from chat.'},...prior,{role:'user',content:input.message.trim()}];
 const r=await fetchImpl(`${QWEN}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(95000),body:JSON.stringify({model,messages,max_tokens:470,temperature:0.5,stream:false,chat_template_kwargs:{enable_thinking:false}})});
 if(!r.ok)throw Error(`Local Qwen returned HTTP ${r.status}`);const j=await r.json();const answer=j.choices?.[0]?.message?.content;if(typeof answer!=='string')throw Error('Qwen returned no answer');return {answer:answer.slice(0,5000),model:short(model,120)};
}
export async function startTask(input,{root=ROOT,node=process.execPath,spawnImpl=spawn}={}){
 if(typeof input.task!=='string'||!input.task.trim()||input.task.length>1000)throw Error('Task must be 1–1000 characters');
 const jobs=await listJobs(root);if(jobs.some(j=>!TERMINAL.has(j.status)))throw Object.assign(new Error('Another task is already running. Check its status or stop it first.'),{status:409});
 const installed=await jsonFile(join(root,'installed.json'));
 if(!installed||typeof installed.root!=='string'||typeof installed.revision!=='string'||!/^[0-9a-f]{40}$/.test(installed.revision))throw Error('Install the pinned guarded Qwen runner first');
 const prefix=resolve(join(root,'versions'));
 const folder=resolve(installed.root);
 if(!folder.startsWith(prefix+'\\')&&!folder.startsWith(prefix+'/'))throw Error('Runner path is outside the pinned version directory');
 const runner=join(folder,'scripts','ally','qwen-terminal-agent.mjs');if(!await exists(runner))throw Error('Pinned runner not found');
 await mkdir(join(root,'jobs'),{recursive:true});
 const id=randomUUID(),dir=jobDir(root,id);await mkdir(dir,{recursive:false});
 const request=join(dir,'input.json');await writeFile(request,JSON.stringify({task:input.task.trim()}),{encoding:'utf8',flag:'wx'});
 const child=spawnImpl(node,[runner,'run','--input',request,'--job-dir',dir],{cwd:folder,detached:true,stdio:'ignore',windowsHide:false,env:process.env});child.unref?.();
 return {id,status:'starting'};
}
export async function stopTask(id,{root=ROOT}={}){if(!jobId(id))throw Error('Invalid job ID');const dir=jobDir(root,id);const state=await jsonFile(join(dir,'state.json'));if(!state)return {id,status:'not_started_or_missing',stopRequested:false};if(TERMINAL.has(state.status))return {id,status:state.status,stopRequested:false};await writeFile(join(dir,'stop'),'owner stop\n',{flag:'w'});return {id,status:state.status,stopRequested:true};}
export function createConsoleServer({root=ROOT,fetchImpl=fetch,panelPath=PANEL,deckPath=DECK,node=process.execPath,spawnImpl=spawn}={}) {
 let starting=false,chatBusy=false;
 return createServer(async(req,res)=>{
  try{
   if(req.headers.host!==`${HOST}:${PORT}`){bad(res,403,'Localhost only');return;}
   const u=new URL(req.url,ORIGIN);if(u.search||u.hash){bad(res,404,'Not found');return;}
   if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/deck')){
    const html=await readFile(u.pathname==='/deck'?deckPath:panelPath);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'SAMEORIGIN','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'"});res.end(html);return;
   }
   if(req.method==='GET'&&u.pathname==='/api/status'){const [qwen,jobs]=await Promise.all([qwenStatus(fetchImpl),listJobs(root)]);reply(res,200,{qwen,jobs,capabilities:['chat','guarded_tasks','activity','stop']});return;}
   if(req.method==='POST'&&!validOrigin(req.headers)){bad(res,403,'Request must come from the local console');return;}
   if(req.method==='POST'&&u.pathname==='/api/chat'){
    if(chatBusy){bad(res,409,'Chat request already running');return;}chatBusy=true;try{reply(res,200,await chat(await bodyJson(req),{fetchImpl}));}finally{chatBusy=false;}return;
   }
   if(req.method==='POST'&&u.pathname==='/api/tasks'){
    if(starting){bad(res,409,'Task start already in progress');return;}starting=true;try{reply(res,202,await startTask(await bodyJson(req),{root,node,spawnImpl}));}finally{starting=false;}return;
   }
   const match=/^\/api\/tasks\/([0-9a-f-]{36})\/stop$/i.exec(u.pathname);
   if(req.method==='POST'&&match){await bodyJson(req);reply(res,200,await stopTask(match[1],{root}));return;}
   bad(res,404,'Not found');
  }catch(e){const status=e.status||(/JSON|body|Message|Task|Invalid|conversation/.test(e.message)?400:503);bad(res,status,status===503?'Local Qwen console unavailable: '+short(e.message,120):short(e.message,150));}
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createConsoleServer();server.on('error',e=>{console.error('Console bind failed:',e.message);process.exitCode=1;});server.listen(PORT,HOST,()=>console.log(`Nexus local Qwen Console at ${ORIGIN} (loopback only)`));
}
