# Versioned, checksum-pinned installer for the local Forge preview + pitch macro. No startup service, credentials or network use at run time.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$PreviewSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$TemplatesSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$PitchSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ProgramSha256,
 [switch]$StageOnly
)
$ErrorActionPreference='Stop'
$base=Join-Path $env:LOCALAPPDATA 'NexusAlly\forge-leads'
$version=Join-Path $base ('preview-versions\'+$Revision)
# repo path => expected hash. The layout under $version mirrors the repo so relative imports resolve.
$files=@(
 @{path='scripts/ally/forge-preview.mjs';hash=$PreviewSha256},
 @{path='public/forge-service-templates.js';hash=$TemplatesSha256},
 @{path='public/forge-pitch.js';hash=$PitchSha256},
 @{path='lib/forgeProgram.js';hash=$ProgramSha256}
)
$node=Join-Path $env:LOCALAPPDATA 'NexusAlly\runtime\node.exe'
if(!(Test-Path -LiteralPath $node)){throw 'Nexus Node runtime not found.'}
foreach($item in $files){
 $target=Join-Path $version ($item.path -replace '/','\')
 [void](New-Item -ItemType Directory -Path (Split-Path $target) -Force)
 if(Test-Path -LiteralPath $target){
  if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.hash){throw 'Existing version differs; refusing to replace it.'}
 }else{
  $staging=$target+'.download'
  try{
   $url='https://raw.githubusercontent.com/jrl6933380-hub/nexus-labs/'+$Revision+'/'+$item.path
   Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile $staging -TimeoutSec 15 -MaximumRedirection 0
   if((Get-Item -LiteralPath $staging).Length -gt 60000){throw 'Unexpected download size.'}
   if((Get-FileHash -LiteralPath $staging -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.hash){throw 'Preview source hash mismatch.'}
   Move-Item -LiteralPath $staging -Destination $target
  }finally{Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue}
 }
 & $node --check $target
 if($LASTEXITCODE -ne 0){throw 'Invalid JavaScript source.'}
}
Write-Output ('STAGED Forge preview '+$Revision)
if($StageOnly){exit}
$manifest=Join-Path $base 'preview-installed.json'
if(Test-Path -LiteralPath $manifest){Copy-Item -LiteralPath $manifest -Destination ($manifest+'.backup-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))}
$temp=$manifest+'.new'
$hashes=@{}
foreach($item in $files){$hashes[$item.path]=$item.hash}
[IO.File]::WriteAllText($temp,(@{revision=$Revision;root=$version;worker=(Join-Path $version 'scripts\ally\forge-preview.mjs');sha256=$hashes}|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temp -Destination $manifest -Force
Write-Output ('INSTALLED Forge preview '+$Revision)
