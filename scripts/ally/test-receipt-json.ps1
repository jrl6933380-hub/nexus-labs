# Run with Windows PowerShell 5.1 or PowerShell 7. No network or device pairing.
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot 'connect.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$null)
$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Call-Nexus'},$true)
if (!$fn) { throw 'Call-Nexus function missing.' }
Invoke-Expression $fn.Extent.Text
$Origin='https://nexus-labs-sigma.vercel.app'
function Invoke-RestMethod {
 param($Uri,$Method,$ContentType,$Headers,$Body,$TimeoutSec)
 return ConvertFrom-Json $Body
}
foreach ($count in @(0,1,2)) {
 $drives=@(for ($i=0;$i -lt $count;$i++) { @{drive="Disk$i";free_bytes=[long]123456789012;total_bytes=[long]234567890123} })
 $r=Call-Nexus 'complete_command' @{session_id='test';command_id='test';result=@{ok=$true;data=@{drives=$drives;read_only=$true}}}
 if ($r.result.data.drives -isnot [array]) { throw 'Drives must remain an array.' }
 if ($r.result.data.drives.Count -ne $count) { throw 'Drive count changed.' }
 foreach ($drive in $r.result.data.drives) {
  if ($drive.free_bytes -ne 123456789012 -or $drive.total_bytes -ne 234567890123) { throw 'Nested drive numbers were lost.' }
 }
}
Write-Host 'PASS: empty, single and multiple drive receipts retain arrays and numeric sizes.'
