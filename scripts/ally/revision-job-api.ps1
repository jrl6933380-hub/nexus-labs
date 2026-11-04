# Small paired-device transport for Nexus private revision jobs.
# Only fixed Nexus API actions; never sends credentials to Qwen.
[CmdletBinding()]
param(
 [ValidateSet('claim','result')][string]$Action='claim',
 [string]$ReviewId='',
 [string]$ClaimId='',
 [ValidateSet('submitted','failed')][string]$State='failed',
 [string]$ChildId='',
 [string]$Reason=''
)
$ErrorActionPreference='Stop'
if($Action -eq 'result'){
 if($ReviewId -notmatch '^[a-f0-9]{32}$' -or $ClaimId -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid revision IDs'}
 if($ChildId -and $ChildId -notmatch '^[a-f0-9]{32}$'){throw 'Invalid child ID'}
 if($Reason.Length -gt 180){throw 'Reason too long'}
}
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
$secret=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$payload=if($Action -eq 'claim'){@{action='revision_claim';input=@{}}}else{@{action='revision_result';input=@{id=$ReviewId;claim_id=$ClaimId;status=$State;child_id=$ChildId;reason=$Reason}}}
$result=Invoke-RestMethod -Uri 'https://nexus-labs-sigma.vercel.app/api/ally-ad-review' -Method POST -ContentType 'application/json' -Headers @{Authorization='Bearer '+$token} -Body ($payload|ConvertTo-Json -Compress -Depth 6) -TimeoutSec 30
$result|ConvertTo-Json -Compress -Depth 8
