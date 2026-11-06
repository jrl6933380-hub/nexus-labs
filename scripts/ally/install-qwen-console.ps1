# Upgrade the existing Nexus Ally Launcher with a local-only Qwen console.
# Downloads SHA-256-pinned files, verifies them, and installs a user-launched shortcut.
# The separate Video to Board macro and its desktop shortcut are never edited.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ServerSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$PanelSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$MemorySha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$AgentSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ToolSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ForgeBrowserSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$MacroRegistrySha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$SubmitReviewSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$LauncherSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$WatcherSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$RevisionTransportSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$BoardWatcherSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$BoardTransportSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$MacroWatcherSha256,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$MacroTransportSha256,
 [switch]$Launch
)
$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'NexusAlly'
$launcherRoot=Join-Path $root 'launcher'
$version=Join-Path (Join-Path $launcherRoot 'versions') $Revision
$node=Join-Path $root 'runtime\node.exe'
if(!(Test-Path -LiteralPath $node)){throw 'Portable Node runtime is missing.'}
$files=@(
 @{path='scripts/ally/qwen-console.mjs';hash=$ServerSha256;min=2000;max=35000},
 @{path='scripts/ally/qwen-memory.mjs';hash=$MemorySha256;min=2000;max=15000},
 @{path='scripts/ally/qwen-terminal-agent.mjs';hash=$AgentSha256;min=10000;max=40000},
 @{path='scripts/ally/qwen-work-tools.mjs';hash=$ToolSha256;min=2000;max=16000},
 @{path='scripts/ally/forge-browser.ps1';hash=$ForgeBrowserSha256;min=2000;max=35000},
 @{path='public/nexus-macro-registry.js';hash=$MacroRegistrySha256;min=3000;max=30000},
 @{path='scripts/ally/submit-ad-review.ps1';hash=$SubmitReviewSha256;min=3500;max=9000},
 @{path='scripts/ally/qwen-revision-watcher.mjs';hash=$WatcherSha256;min=2000;max=35000},
 @{path='scripts/ally/revision-transport.ps1';hash=$RevisionTransportSha256;min=1000;max=10000},
 @{path='scripts/ally/approved-board-watcher.mjs';hash=$BoardWatcherSha256;min=3000;max=18000},
 @{path='scripts/ally/approved-board-transport.ps1';hash=$BoardTransportSha256;min=1000;max=10000},
 @{path='scripts/ally/macro-job-watcher.mjs';hash=$MacroWatcherSha256;min=5000;max=18000},
 @{path='scripts/ally/macro-job-transport.ps1';hash=$MacroTransportSha256;min=1000;max=10000},
 @{path='public/ally-qwen-console.html';hash=$PanelSha256;min=2000;max=50000},
 @{path='public/ally-launcher.html';hash=$LauncherSha256;min=3000;max=80000}
)
foreach($item in $files){
 $rel=[string]$item.path
 $dest=Join-Path $version ($rel.Replace('/',[IO.Path]::DirectorySeparatorChar))
 [void](New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force)
 $temp=$dest+'.staging'+[IO.Path]::GetExtension($dest)
 $url='https://raw.githubusercontent.com/jrl6933380-hub/nexus-labs/'+$Revision+'/'+$rel
 Invoke-WebRequest -Uri $url -OutFile $temp -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 0
 $size=(Get-Item -LiteralPath $temp).Length
 if($size -lt $item.min -or $size -gt $item.max){Remove-Item $temp -Force;throw ('File size invalid: '+$rel)}
 $actual=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant()
 if($actual -ne $item.hash){Remove-Item $temp -Force;throw ('SHA-256 mismatch: '+$rel)}
 if($rel.EndsWith('.mjs')){& $node --check $temp;if($LASTEXITCODE -ne 0){throw 'Console syntax failed'}}
 if($rel.EndsWith('.ps1')){$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($temp,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){throw 'Revision transport syntax failed'}}
 if($rel.EndsWith('.html')){$head=[IO.File]::ReadAllText($temp);if(!$head.StartsWith('<!doctype html>',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid HTML'}}
 Move-Item -LiteralPath $temp -Destination $dest -Force
}
# Pin and activate the guarded task runner at the same reviewed Git
# commit as the Qwen console; both version manifests must match.
$terminalRoot=Join-Path $root 'qwen-terminal'
$terminalVersion=Join-Path (Join-Path $terminalRoot 'versions') $Revision
$agentSource=Join-Path $version 'scripts\ally\qwen-terminal-agent.mjs'
$copies=@(
 @{from='scripts\ally\qwen-terminal-agent.mjs';hash=$AgentSha256},
 @{from='scripts\ally\qwen-work-tools.mjs';hash=$ToolSha256},
 @{from='scripts\ally\forge-browser.ps1';hash=$ForgeBrowserSha256},
 @{from='public\nexus-macro-registry.js';hash=$MacroRegistrySha256},
 @{from='scripts\ally\submit-ad-review.ps1';hash=$SubmitReviewSha256}
)
foreach($copy in $copies){
 $source=Join-Path $version $copy.from
 $dest=Join-Path $terminalVersion $copy.from
 [void](New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force)
 Copy-Item -LiteralPath $source -Destination $dest -Force
 $actualHash=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
 if($actualHash -ne $copy.hash){throw ('Pinned local Qwen tool hash mismatch: '+$copy.from)}
}
$terminalManifest=Join-Path $terminalRoot 'installed.json'
$terminalStaging=$terminalManifest+'.staging'
[IO.File]::WriteAllText($terminalStaging,(@{revision=$Revision;root=$terminalVersion}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $terminalStaging -Destination $terminalManifest -Force

$server=Join-Path $version 'scripts\ally\qwen-console.mjs'
$launcher=Join-Path $version 'public\ally-launcher.html'
$edgeCandidates=@("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$edge=$edgeCandidates|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
if(!$edge){throw 'Microsoft Edge not found.'}
$start=Join-Path $launcherRoot 'Start Nexus Ally Launcher.ps1'
# Values are local file paths and escaped before inclusion in generated PowerShell.
$quote={param($value) "'"+([string]$value).Replace("'","''")+"'"}
$startText=@'
$ErrorActionPreference='Stop'
$node=__NODE__
$runner=__SERVER__
$edge=__EDGE__
$launcher=__LAUNCHER__
$version=__VERSION__
try {
 $health=Invoke-WebRequest -Uri 'http://127.0.0.1:9942/deck' -UseBasicParsing -TimeoutSec 2
 if($health.StatusCode -ne 200){throw 'Server not listening'}
}catch{
 Start-Process -FilePath $node -ArgumentList @(('"'+$runner+'"')) -WorkingDirectory $version -WindowStyle Minimized | Out-Null
 Start-Sleep -Milliseconds 950
}
# Prefer the same-origin localhost deck so embedded Qwen console works under Edge.
$uri='http://127.0.0.1:9942/deck'
try{$check=Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 3;if($check.StatusCode -ne 200){throw 'Console offline'}}catch{$uri=([Uri]$launcher).AbsoluteUri}
Start-Process -FilePath $edge -ArgumentList @('--app='+$uri,'--start-maximized')
'@
$startText=$startText.Replace('__NODE__',(& $quote $node)).Replace('__SERVER__',(& $quote $server)).Replace('__EDGE__',(& $quote $edge)).Replace('__LAUNCHER__',(& $quote $launcher)).Replace('__VERSION__',(& $quote $version))
$tokens=$null;$errors=$null
[void][Management.Automation.Language.Parser]::ParseInput($startText,[ref]$tokens,[ref]$errors)
if($errors.Count -gt 0){throw 'Generated launcher failed syntax validation.'}
[IO.File]::WriteAllText($start,$startText,(New-Object Text.UTF8Encoding($false)))
$desktop=[Environment]::GetFolderPath('Desktop')
$shortcut=Join-Path $desktop 'Nexus Ally Launcher.lnk'
$ps=Join-Path $PSHOME 'powershell.exe'
$wsh=New-Object -ComObject WScript.Shell
$link=$wsh.CreateShortcut($shortcut)
$link.TargetPath=$ps
$link.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$start+'"'
$link.WorkingDirectory=$launcherRoot
$link.Description='Nexus Ally command deck and local Qwen console'
$link.WindowStyle=7
$link.IconLocation=$edge+',0'
$link.Save()
$manifest=Join-Path $launcherRoot 'installed.json'
$staging=$manifest+'.staging'
[IO.File]::WriteAllText($staging,(@{revision=$Revision;file=$launcher;shortcut=$shortcut;sha256=$LauncherSha256;console=$server;panel=(Join-Path $version 'public\ally-qwen-console.html')}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $staging -Destination $manifest -Force
Write-Output ('INSTALLED Qwen Console at localhost:9942; launcher shortcut updated; revision '+$Revision)
Write-Output ('SERVER '+$server)
Write-Output ('DESKTOP '+$shortcut)
Write-Output 'Qwen chat, memory, browser search, Macro Controller and isolated work runner pinned to the same revision.'
Write-Output 'Reopen the Qwen Console after closing its old local process.'
Write-Output 'No auto-start, shell replacement, or new device pairing.'
if($Launch){& $start}
