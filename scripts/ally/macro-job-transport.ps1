# Owner-paired Ally transport for Nexus Macro Controller. Fixed production origin.
# Do not print or pass the existing DPAPI device token to Qwen.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('claim','heartbeat','complete','fail')][string]$Action,
 [string]$JobId='',
 [string]$ClaimToken='',
 [string]$Stage='',
 [string]$ProjectId='',
 [string]$ReviewId='',
 [string]$Message=''
)
$ErrorActionPreference='Stop'
if($Action -ne 'claim'){
 if($JobId -notmatch '^[a-f0-9]{32}$' -or $ClaimToken -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid macro claim'}
}
if($ProjectId -and $ProjectId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$'){throw 'Invalid ad project'}
if($Action -eq 'complete' -and ($ReviewId -notmatch '^[a-f0-9]{32}$' -or !$ProjectId)){throw 'Invalid private review receipt'}
if($Action -eq 'fail' -and $Message.Length -gt 180){throw 'Failure reason too long'}
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential -PathType Leaf)){throw 'Pair the Ally first'}
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
$fields=@{}
switch($Action){
 'claim' {$actionName='device_claim'}
 'heartbeat' {$actionName='device_heartbeat';$fields=@{id=$JobId;token=$ClaimToken;stage=$Stage};if($ProjectId){$fields.project_id=$ProjectId}}
 'complete' {$actionName='device_complete';$fields=@{id=$JobId;token=$ClaimToken;project_id=$ProjectId;review_id=$ReviewId}}
 'fail' {$actionName='device_fail';$fields=@{id=$JobId;token=$ClaimToken;message=$Message}}
}
$payload=@{action=$actionName;input=$fields}|ConvertTo-Json -Depth 6 -Compress
$reply=Invoke-RestMethod -Uri 'https://nexus-labs-sigma.vercel.app/api/macro-jobs' -Method POST -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 25
if($null -eq $reply){throw 'Empty private job response'}
ConvertTo-Json -InputObject $reply -Depth 7 -Compress
