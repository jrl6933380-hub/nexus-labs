import {writeFile,readFile,rename,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw Error('Cannot check the prior worker. Inspect it before recovering.');}}
async function otherWorkers(){
 if(process.platform!=='win32')throw Error('Legacy lock recovery requires a Windows worker check.');
 const script="$ErrorActionPreference='Stop';$p=@(Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object {$_.CommandLine -like '*forge-leads.mjs*' -and $_.ProcessId -ne "+process.pid+"});Write-Output $p.Count";
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{shell:false,windowsHide:true,timeout:10000,maxBuffer:1000});
 const count=String(stdout).trim();if(!/^\d+$/.test(count))throw Error('Unable to check research workers.');return Number(count)>0;
}
// A recovered lock is archived, never deleted. No interrupted browser/import step is replayed.
export async function acquireResearchLock(root,{isAlive=alive,hasOtherWorkers=otherWorkers,now=Date.now}={}){
 const path=join(root,'active.lock'),recoveryPath=join(root,'recovery.lock');
 const token=randomUUID(),metadata={version:2,pid:process.pid,token,started_at:new Date(now()).toISOString()};
 const create=()=>writeFile(path,JSON.stringify(metadata),{flag:'wx',mode:0o600});
 let recovered=false;
 try{await create();}catch(e){
  if(e.code!=='EEXIST')throw e;
  try{await writeFile(recoveryPath,JSON.stringify(metadata),{flag:'wx',mode:0o600});}
  catch(e){if(e.code==='EEXIST')throw Error('Another recovery check is active. Inspect recovery.lock if a prior recovery was interrupted.');throw e;}
  try{
   const original=await readFile(path,'utf8');let previous=null;
   if(original.trim()){
    try{previous=JSON.parse(original);}catch{throw Error('Unrecognized lock. Inspect it before recovery.');}
    if(previous.version!==2||!Number.isInteger(previous.pid)||previous.pid<1||typeof previous.token!=='string')throw Error('Unrecognized lock. Inspect it before recovery.');
    if(await isAlive(previous.pid))throw Error('A research worker is already running.');
   }else if(now()-(await stat(path)).mtimeMs<10000){throw Error('A research worker is starting. Wait before retrying.');}
   if(await hasOtherWorkers())throw Error('A research worker is already running.');
   if(await readFile(path,'utf8')!==original)throw Error('Research lock changed; start again after checking the worker.');
   await rename(path,path+'.recovered-'+randomUUID());await create();recovered=true;
  }finally{
   // Only remove the recovery guard this process owns.
   const guard=JSON.parse(await readFile(recoveryPath,'utf8'));if(guard.token===token)await unlink(recoveryPath);
  }
 }
 return {recovered,async release(){
  try{const current=JSON.parse(await readFile(path,'utf8'));if(current.token===token)await unlink(path);}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }};
}
