# Separate fixed-origin transport for owner-approved videos to the private Nexus board.
# Reads the existing DPAPI-paired Ally token; never prints it or accepts a URL.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('claim','complete','fail')][string]$Action,
 [string]$ReviewId='',
 [string]$BoardToken='',
 [string]$RunId='',
 [string]$Message=''
)
$ErrorActionPreference='Stop'
if($Action -ne 'claim'){
 if($ReviewId -notmatch '^[a-f0-9]{32}$' -or $BoardToken -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid board claim'}
}
if($Action -eq 'complete' -and $RunId -notmatch '^[a-f0-9]{32}$'){throw 'Invalid board receipt'}
if($Action -eq 'fail' -and $Message.Length -gt 180){throw 'Invalid failure message'}
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential -PathType Leaf)){throw 'Pair the Ally first'}
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
$fields=@{}
switch($Action){
 'claim' {$actionName='board_claim'}
 'complete' {$actionName='board_complete';$fields=@{id=$ReviewId;token=$BoardToken;run_id=$RunId}}
 'fail' {$actionName='board_fail';$fields=@{id=$ReviewId;token=$BoardToken;message=$Message}}
}
$payload=@{action=$actionName;input=$fields}|ConvertTo-Json -Depth 4 -Compress
$reply=Invoke-RestMethod -Uri 'https://nexus-labs-sigma.vercel.app/api/ally-ad-review' -Method POST -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 25
if($null -eq $reply){throw 'Empty private board response'}
ConvertTo-Json -InputObject $reply -Depth 6 -Compress
