# Owner-paired Ally transport for Forge lead jobs. Fixed production origin.
# Uses the existing DPAPI device token; it is never printed or passed to Qwen.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('claim','heartbeat','complete','fail')][string]$Action,
 [string]$JobId='',
 [string]$ClaimToken='',
 [string]$Stage='',
 [string]$ResultFile='',
 [string]$Message=''
)
$ErrorActionPreference='Stop'
if($Action -ne 'claim'){
 if($JobId -notmatch '^[a-f0-9]{32}$' -or $ClaimToken -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid lead job claim'}
}
if($Action -eq 'heartbeat' -and $Stage -notmatch '^(claimed|searching|building|uploading)$'){throw 'Invalid stage'}
if($Action -eq 'fail' -and $Message.Length -gt 180){throw 'Failure reason too long'}
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential -PathType Leaf)){throw 'Pair the Ally first'}
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
if($Action -eq 'complete'){
 $resultRoot=Join-Path $env:LOCALAPPDATA 'NexusAlly\forge-lead-results'
 $full=[IO.Path]::GetFullPath($ResultFile)
 if(-not $full.StartsWith($resultRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $full -PathType Leaf)){throw 'Unexpected result file'}
 if((Get-Item -LiteralPath $full).Length -gt 950000){throw 'Result too large'}
 $raw=[IO.File]::ReadAllText($full,[Text.Encoding]::UTF8)
 [void]($raw|ConvertFrom-Json)
 $body='{"action":"device_complete","input":{"id":"'+$JobId+'","token":"'+$ClaimToken+'","result":'+$raw+'}}'
}else{
 switch($Action){
  'claim' {$payload=@{action='device_claim';input=@{}}}
  'heartbeat' {$payload=@{action='device_heartbeat';input=@{id=$JobId;token=$ClaimToken;stage=$Stage}}}
  'fail' {$payload=@{action='device_fail';input=@{id=$JobId;token=$ClaimToken;message=$Message}}}
 }
 $body=$payload|ConvertTo-Json -Depth 6 -Compress
}
$bytes=[Text.Encoding]::UTF8.GetBytes($body)
$reply=Invoke-RestMethod -Uri 'https://nexus-labs-sigma.vercel.app/api/forge-lead-jobs' -Method POST -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 40
if($null -eq $reply){throw 'Empty lead job response'}
ConvertTo-Json -InputObject $reply -Depth 7 -Compress
