# Install the offline Nexus Ally launcher as an ordinary Windows app shortcut.
# Source is fixed to this repository and pinned to a reviewed commit + SHA-256.
# This does not replace Explorer, change startup, request admin, or grant model permissions.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$Sha256,
 [switch]$Launch
)
$ErrorActionPreference='Stop'
$base=Join-Path $env:LOCALAPPDATA 'NexusAlly\launcher'
$version=Join-Path (Join-Path $base 'versions') $Revision
$target=Join-Path $version 'ally-launcher.html'
$staging=Join-Path $version 'ally-launcher.download'
[void](New-Item -ItemType Directory -Path $version -Force)
$url='https://raw.githubusercontent.com/jrl6933380-hub/nexus-labs/'+$Revision+'/public/ally-launcher.html'
try {
 Invoke-WebRequest -Uri $url -OutFile $staging -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 0
 $size=(Get-Item -LiteralPath $staging).Length
 if($size -lt 1500 -or $size -gt 120000){throw 'Launcher download size outside expected bounds.'}
 $actual=(Get-FileHash -LiteralPath $staging -Algorithm SHA256).Hash.ToLowerInvariant()
 if($actual -ne $Sha256){throw 'Launcher SHA-256 mismatch; refusing installation.'}
 $head=[IO.File]::ReadAllText($staging)
 if(-not $head.StartsWith('<!doctype html>',[StringComparison]::OrdinalIgnoreCase)) {throw 'Launcher document is invalid.'}
 Move-Item -LiteralPath $staging -Destination $target -Force
} finally { Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue }
$edge=@(
 (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
 (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)|Where-Object { $_ -and (Test-Path -LiteralPath $_) }|Select-Object -First 1
if(-not $edge){$command=Get-Command msedge.exe -ErrorAction SilentlyContinue;if($command){$edge=$command.Source}}
if(-not $edge){throw 'Microsoft Edge not found. HTML is installed but shortcut was not created.'}
$uri=([Uri]::new($target)).AbsoluteUri
$args='--app="'+$uri+'" --start-maximized'
$desktop=[Environment]::GetFolderPath('Desktop')
if(-not $desktop){throw 'Windows desktop folder unavailable.'}
$shortcut=Join-Path $desktop 'Nexus Ally Launcher.lnk'
$wsh=New-Object -ComObject WScript.Shell
$link=$wsh.CreateShortcut($shortcut)
$link.TargetPath=$edge
$link.Arguments=$args
$link.WorkingDirectory=$version
$link.Description='Nexus Ally customizable local command deck'
$link.WindowStyle=3
$link.Save()
$meta=Join-Path $base 'installed.json'
$stage=$meta+'.new'
[IO.File]::WriteAllText($stage,(@{revision=$Revision;file=$target;shortcut=$shortcut;sha256=$Sha256}|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)
Move-Item -LiteralPath $stage -Destination $meta -Force
Write-Output ('INSTALLED Nexus Ally Launcher '+$Revision)
Write-Output ('FILE '+$target)
Write-Output ('SHORTCUT '+$shortcut)
Write-Output 'Windows shell and existing Ally pairing unchanged; no auto-start added.'
if($Launch){Start-Process -FilePath $edge -ArgumentList $args}
