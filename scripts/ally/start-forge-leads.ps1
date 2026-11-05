# Visible, owner-started finite macro. No service, startup task, or public posting.
[CmdletBinding()]
param([string]$BusinessType,[string]$City,[ValidateRange(1,10)][int]$Count=10,[switch]$Check)
$ErrorActionPreference='Stop'
$node=Join-Path $env:LOCALAPPDATA 'NexusAlly\runtime\node.exe'
if(!(Test-Path -LiteralPath $node)){throw 'The installed Nexus Node runtime is required.'}
$worker=Join-Path $PSScriptRoot 'forge-leads.mjs'
if($Check){& $node $worker '--check';exit $LASTEXITCODE}
Add-Type -AssemblyName Microsoft.VisualBasic
if(!$BusinessType){$BusinessType=[Microsoft.VisualBasic.Interaction]::InputBox('What kind of businesses? Example: barbers','Find Forge Leads','barbers')}
if(!$BusinessType){exit}
if(!$City){$City=[Microsoft.VisualBasic.Interaction]::InputBox('Which city or area?','Find Forge Leads','Des Moines, Iowa')}
if(!$City){exit}
Write-Host 'Find Forge Leads - Google AI Mode + local Qwen'
Write-Host 'Keep the Google windows open. Ctrl+C cancels. Sign-in or verification pauses the batch.'
& $node $worker '--business' $BusinessType '--city' $City '--count' "$Count"
$result=$LASTEXITCODE
if($result -ne 0){Write-Host 'The batch stopped. Check its status file before starting another batch.'}
Read-Host 'Press Enter to close this macro window'
exit $result
