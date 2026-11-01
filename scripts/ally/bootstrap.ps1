# Nexus Ally bootstrap: safe, repeatable, local-only setup.
# No network download or remote access is enabled by this script.
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Repair,
  [switch]$Check,
  [string]$InstallDir = "$env:LOCALAPPDATA\NexusAlly"
)
$ErrorActionPreference='Stop'
if (-not ($Install -or $Repair -or $Check)) { $Check=$true }
$selected = @($Install, $Repair, $Check) | Where-Object { $_ }
if (@($selected).Count -gt 1) { throw 'Choose one mode only.' }

function Find-Command([string]$name) {
  $cmd=Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}
function Report {
  $os = Get-CimInstance Win32_OperatingSystem
  $drive = Get-PSDrive -Name C -ErrorAction SilentlyContinue
  [ordered]@{
    schema='nexus.ally.bootstrap.v1'
    atUtc=[datetime]::UtcNow.ToString('o')
    mode=$(if($Install){'install'}elseif($Repair){'repair'}else{'check'})
    windows=$os.Caption
    ramBytes=[long]$os.TotalVisibleMemorySize*1024
    cFreeBytes=$(if($drive){[long]$drive.Free}else{$null})
    llamaServer=(Find-Command 'llama-server.exe')
    powershell=$PSVersionTable.PSVersion.ToString()
    bridgeInstalled=(Test-Path -LiteralPath (Join-Path $InstallDir 'bridge.exe'))
    notes=@('Qwen model files are never modified.','Bridge is not installed until a signed, verified Windows companion is available.','No firewall or startup settings are changed.')
  }
}
if ($Check) { Report | ConvertTo-Json -Depth 4; exit 0 }
if (-not (Test-Path -LiteralPath $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
$readme=Join-Path $InstallDir 'README.txt'
@'
Nexus Ally local bootstrap staging
This directory is reserved for the future, signed Nexus Ally Bridge.
No remote-control program was installed or launched.
Do not copy secrets or login credentials here.
To install a future bridge, use its signed release and an owner-authorized pairing flow.
Qwen and all Windows/game files are unchanged.
'@ | Set-Content -LiteralPath $readme -Encoding UTF8
Report | ConvertTo-Json -Depth 4
