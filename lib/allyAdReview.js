// A typed routine over the existing terminal transport; user/model text is JSON data only.
import {randomUUID} from 'node:crypto';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
const base = "$root=Join-Path $env:LOCALAPPDATA 'NexusAlly\\ad-review';";
const jobPath = id => {
  if (!ID.test(id || '')) throw new Error('Valid review job_id required.');
  return base + "$dir=Join-Path (Join-Path $root 'jobs') " + quote(id) + ';';
};
export function createAllyAdReview({ally, uuid = randomUUID}) {
  const send = async (owner, script, extra = {}) => {
    if (script.length > 4000) throw new Error('Review command exceeds transport limit.');
    const receipt = await ally.enqueue(owner, {action:'terminal', script, timeout_seconds:10});
    return {...receipt, ...extra, requires_result_read:true};
  };
  return {
    async start(owner, {brief}) {
      if (typeof brief !== 'string' || !brief.trim() || brief.length > 1000) throw new Error('Brief must be 1–1000 characters.');
      const id=uuid();
      const script=jobPath(id)+
        "$install=Get-Content (Join-Path $root 'installed.json') -Raw|ConvertFrom-Json;"+
        "$node=Join-Path (Join-Path $env:LOCALAPPDATA 'NexusAlly\\runtime') 'node.exe';"+
        "$runner=Join-Path $install.root 'scripts\\ally\\ad-review-loop.mjs';"+
        "if(!(Test-Path $node) -or !(Test-Path $runner)){throw 'Install the local ad review routine first.'};"+
        "if(Test-Path $dir){throw 'Review job already exists; inspect it instead of replaying.'};"+
        "[void](New-Item -ItemType Directory -Path $dir -Force);$inputPath=Join-Path $dir 'request.json';"+
        '[IO.File]::WriteAllText($inputPath,'+quote(JSON.stringify({brief,targetSec:15}))+',[Text.Encoding]::UTF8);'+
        "$p=Start-Process -FilePath $node -ArgumentList @(('\"'+$runner+'\"'),'run','--input',('\"'+$inputPath+'\"'),'--job-dir',('\"'+$dir+'\"')) -PassThru;"+
        '@{job_id='+quote(id)+';pid=$p.Id;status=\'starting\'}|ConvertTo-Json -Compress';
      return send(owner,script, {job_id:id});
    },
    async status(owner, {job_id}) {
      return send(owner,jobPath(job_id)+"$state=Join-Path $dir 'state.json';if(Test-Path $state){Get-Content $state -Raw}else{Write-Output '{\"status\":\"not_found_or_starting\"}'}",{job_id});
    },
    async stop(owner, {job_id}) {
      return send(owner,jobPath(job_id)+"$state=Get-Content (Join-Path $dir 'state.json') -Raw|ConvertFrom-Json;if($state.status -in @('awaiting_visual_review','needs_help','failed','canceled')){@{status=$state.status;stopRequested=$false}|ConvertTo-Json -Compress}else{[IO.File]::WriteAllText((Join-Path $dir 'stop'),'owner requested stop');Write-Output '{\"stopRequested\":true}'}",{job_id});
    },
  };
}
