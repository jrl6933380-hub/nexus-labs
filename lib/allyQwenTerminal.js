// Owner-only typed controls over existing paired Ally terminal transport.
// Requests are task data; no model output is spliced into PowerShell.
import {randomUUID} from 'node:crypto';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const quote=x=>"'"+String(x).replace(/'/g,"''")+"'";
const base="$root=Join-Path $env:LOCALAPPDATA 'NexusAlly\\qwen-terminal';";
const jobPath=id=>{if(!ID.test(id||''))throw new Error('A valid job_id is required.');return base+"$dir=Join-Path (Join-Path $root 'jobs') "+quote(id)+';';};
export function createAllyQwenTerminal({ally,uuid=randomUUID}){
 const send=async(owner,script,extra={})=>{
  if(script.length>4000)throw new Error('Command too long for terminal transport.');
  const receipt=await ally.enqueue(owner,{action:'terminal',script,timeout_seconds:10});
  return {...receipt,...extra,requires_result_read:true};
 };
 return {
  async start(owner,{task}){
   if(typeof task!=='string'||!task.trim()||task.length>1000||/[\u0000-\u001f]/.test(task))throw new Error('Task must be 1–1000 printable characters.');
   const id=uuid();const script=jobPath(id)+
    "$install=Get-Content (Join-Path $root 'installed.json') -Raw|ConvertFrom-Json;"+
    "$node=Join-Path $env:LOCALAPPDATA 'NexusAlly\\runtime\\node.exe';"+
    "$runner=Join-Path $install.root 'scripts\\ally\\qwen-terminal-agent.mjs';"+
    "if(!(Test-Path $node) -or !(Test-Path $runner)){throw 'Install Qwen terminal routine first.'};"+
    "if(Test-Path $dir){throw 'Job already exists; inspect it.'};"+
    "[void](New-Item -ItemType Directory -Path $dir -Force);$inputPath=Join-Path $dir 'input.json';"+
    '[IO.File]::WriteAllText($inputPath,'+quote(JSON.stringify({task}))+',[Text.Encoding]::UTF8);'+
    "$p=Start-Process -FilePath $node -ArgumentList @(('\"'+$runner+'\"'),'run','--input',('\"'+$inputPath+'\"'),'--job-dir',('\"'+$dir+'\"')) -PassThru;"+
    '@{job_id='+quote(id)+';pid=$p.Id;status=\'starting\'}|ConvertTo-Json -Compress';
   return send(owner,script,{job_id:id});
  },
  async status(owner,{job_id}){return send(owner,jobPath(job_id)+"$state=Join-Path $dir 'state.json';if(Test-Path $state){Get-Content $state -Raw}else{Write-Output '{\"status\":\"not_found_or_starting\"}'}",{job_id});},
  async stop(owner,{job_id}){return send(owner,jobPath(job_id)+"$state=Get-Content (Join-Path $dir 'state.json') -Raw|ConvertFrom-Json;if($state.status -in @('done','needs_help','needs_approval','failed','canceled')){@{status=$state.status;stopRequested=$false}|ConvertTo-Json -Compress}else{[IO.File]::WriteAllText((Join-Path $dir 'stop'),'owner requested stop');Write-Output '{\"stopRequested\":true}'}",{job_id});},
 };
}
