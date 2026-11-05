# Versioned installer for the reviewed local research macro. No startup service or credentials.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$WorkerSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$RecoverySha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$BrowserSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$StarterSha256,
 [switch]$StageOnly
)
$ErrorActionPreference='Stop'
$base=Join-Path $env:LOCALAPPDATA 'NexusAlly\forge-leads'
$version=Join-Path $base ('versions\'+$Revision)
$hashes=@{'forge-leads.mjs'=$WorkerSha256;'forge-recovery.mjs'=$RecoverySha256;'forge-browser.ps1'=$BrowserSha256;'start-forge-leads.ps1'=$StarterSha256}
[void](New-Item -ItemType Directory -Path $version -Force)
$node=Join-Path $env:LOCALAPPDATA 'NexusAlly\runtime\node.exe'
if(!(Test-Path -LiteralPath $node)){throw 'Nexus Node runtime not found.'}
foreach($name in $hashes.Keys){
 $target=Join-Path $version $name
 if(Test-Path -LiteralPath $target){
  if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes[$name]){throw 'Existing version differs; refusing to replace it.'}
 }else{
  $staging=$target+'.download'
  try{
   $url='https://raw.githubusercontent.com/jrl6933380-hub/nexus-labs/'+$Revision+'/scripts/ally/'+$name
   Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile $staging -TimeoutSec 15 -MaximumRedirection 0
   if((Get-Item -LiteralPath $staging).Length -gt 50000){throw 'Unexpected download size.'}
   if((Get-FileHash -LiteralPath $staging -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes[$name]){throw 'Research source hash mismatch.'}
   Move-Item -LiteralPath $staging -Destination $target
  }finally{Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue}
 }
 if($name -like '*.ps1'){
  $tokens=$null;$errors=$null
  [void][Management.Automation.Language.Parser]::ParseFile($target,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw ($errors|Out-String)}
 }else{& $node --check $target;if($LASTEXITCODE -ne 0){throw 'Invalid JavaScript source.'}}
}
Write-Output ('STAGED Forge research '+$Revision)
if($StageOnly){exit}
$workers=@(Get-CimInstance Win32_Process -Filter "name='node.exe'"|Where-Object {$_.CommandLine -like '*forge-leads.mjs*'})
if($workers.Count){throw 'Close or finish the research macro before activating this version.'}
$manifest=Join-Path $base 'installed.json'
if(Test-Path -LiteralPath $manifest){Copy-Item -LiteralPath $manifest -Destination ($manifest+'.backup-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))}
$wsh=New-Object -ComObject WScript.Shell
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
 $shortcut=Join-Path $folder 'Find Forge Leads.lnk'
 $link=$wsh.CreateShortcut($shortcut);$link.TargetPath=Join-Path $PSHOME 'powershell.exe'
 $link.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $version 'start-forge-leads.ps1')+'"'
 $link.WorkingDirectory=$version;$link.Description='Find and review business leads with Google and local Qwen';$link.Save()
}
$temp=$manifest+'.new'
[IO.File]::WriteAllText($temp,(@{revision=$Revision;root=$version;sha256=$hashes}|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temp -Destination $manifest -Force
Write-Output ('INSTALLED Forge research '+$Revision)
if(!(Test-Path -LiteralPath (Join-Path $base 'batches\active.lock'))){
 & $node (Join-Path $version 'forge-leads.mjs') --refresh-reviews
 if($LASTEXITCODE -ne 0){Write-Warning 'Installed successfully; some saved reviews need inspection before refresh.'}
}
