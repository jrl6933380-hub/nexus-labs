# Fixed-origin authenticated transport for owner-requested ad revisions.
# Only this local process reads the existing DPAPI device token. Never print it.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('claim','renew','complete','fail')][string]$Action,
 [string]$ReviewId='',
 [string]$RevisionToken='',
 [string]$ChildId='',
 [string]$Message=''
)
$ErrorActionPreference='Stop'
if($Action -ne 'claim'){
 if($ReviewId -notmatch '^[a-f0-9]{32}$' -or $RevisionToken -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid revision claim'}
}
if($Action -eq 'complete' -and $ChildId -notmatch '^[a-f0-9]{32}$'){throw 'Invalid child review ID'}
if($Action -eq 'fail' -and $Message.Length -gt 180){throw 'Error message too long'}
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential -PathType Leaf)){throw 'Pair the Ally first'}
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
$fields=@{}
switch($Action){
 'claim' {$actionName='revision_claim'}
 'renew' {$actionName='revision_renew';$fields=@{id=$ReviewId;token=$RevisionToken}}
 'complete' {$actionName='revision_complete';$fields=@{id=$ReviewId;token=$RevisionToken;child_id=$ChildId}}
 'fail' {$actionName='revision_fail';$fields=@{id=$ReviewId;token=$RevisionToken;message=$Message}}
}
$payload=@{action=$actionName;input=$fields}|ConvertTo-Json -Depth 5 -Compress
$reply=Invoke-RestMethod -Uri 'https://nexus-labs-sigma.vercel.app/api/ally-ad-review' -Method POST -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 25
if($null -eq $reply){throw 'Empty Nexus revision response'}
ConvertTo-Json -InputObject $reply -Depth 7 -Compress
