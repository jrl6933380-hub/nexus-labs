# Owner-paired Ally transport for Forge lead jobs. Fixed production origin.
# Uses the existing DPAPI device token; it is never printed or passed to Qwen.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('claim','heartbeat','complete','fail','mission_get','mission_start','mission_add','mission_control')][string]$Action,
 [string]$JobId='',
 [string]$ClaimToken='',
 [string]$Stage='',
 [string]$ResultFile='',
 [string]$Message='',
 [string]$Business='',
 [string]$Cities='',
 [int]$Count=5,
 [int]$MaxCities=25,
 [string]$Control=''
)
$ErrorActionPreference='Stop'
if($Action -in 'heartbeat','complete','fail'){
 if($JobId -notmatch '^[a-f0-9]{32}$' -or $ClaimToken -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid lead job claim'}
}
if($Action -eq 'heartbeat' -and $Stage -notmatch '^(claimed|searching|building|uploading)$'){throw 'Invalid stage'}
if($Action -eq 'fail' -and $Message.Length -gt 180){throw 'Failure reason too long'}
if($Action -eq 'mission_start'){
 if($Business -notmatch '^[\p{L}\p{N} .,''&-]{2,80}$' -or $Count -lt 1 -or $Count -gt 10 -or $MaxCities -lt 1 -or $MaxCities -gt 25){throw 'Invalid mission'}
}
if($Action -eq 'mission_add'){
 $list=@($Cities -split ',' | ForEach-Object {$_.Trim()} | Where-Object {$_})
 if($list.Count -lt 1 -or $list.Count -gt 5){throw 'Add 1-5 cities'}
 foreach($c in $list){if($c -notmatch '^[\p{L}\p{N} .,''&-]{2,60}$'){throw 'Use plain city names'}}
}
if($Action -eq 'mission_control' -and $Control -notmatch '^(pause|resume)$'){throw 'Invalid mission control'}
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
  'mission_get' {$payload=@{action='device_mission_get';input=@{}}}
  'mission_start' {$payload=@{action='device_mission_start';input=@{request_id=('q'+[guid]::NewGuid().ToString('N'));business=$Business;region='iowa';count=$Count;max_cities=$MaxCities;auto_build=$true}}}
  'mission_add' {$payload=@{action='device_mission_add';input=@{cities=@($list)}}}
  'mission_control' {$payload=@{action='device_mission_control';input=@{control=$Control}}}
 }
 $body=$payload|ConvertTo-Json -Depth 6 -Compress
}
$bytes=[Text.Encoding]::UTF8.GetBytes($body)
$reply=Invoke-RestMethod -Uri 'https://nexus-labs-sigma.vercel.app/api/forge-lead-jobs' -Method POST -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 40
if($null -eq $reply){throw 'Empty lead job response'}
ConvertTo-Json -InputObject $reply -Depth 7 -Compress
