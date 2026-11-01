# Nexus Ally v0.1 — interactive owner-paired heartbeat ONLY.
# No remote commands, screenshots, keyboard control or auto-start.
[CmdletBinding()]
param(
 [ValidateSet('Pair','Connect','Disconnect')][string]$Action='Connect',
 [string]$Origin='https://nexus-labs-sigma.vercel.app'
)
$ErrorActionPreference='Stop'
if ($Origin -ne 'https://nexus-labs-sigma.vercel.app') { throw 'Untrusted Nexus origin.' }
$base=Join-Path $env:LOCALAPPDATA 'NexusAlly'
$credential=Join-Path $base 'device-token.xml'
function Call-Nexus([string]$method,[hashtable]$data,[string]$token=''){
 $headers=@{}
 if ($token) {$headers.Authorization='Bearer '+$token}
 return Invoke-RestMethod -Uri ($Origin+'/api/ally') -Method POST -ContentType 'application/json' -Headers $headers -Body (@{action=$method}+$data | ConvertTo-Json -Compress) -TimeoutSec 12
}
if ($Action -eq 'Pair') {
 if (!(Test-Path -LiteralPath $base)) { New-Item -ItemType Directory -Path $base | Out-Null }
 $code=Read-Host 'Enter short-lived pairing code from your Nexus Ally page'
 $reply=Call-Nexus 'pair' @{code=$code;label='ROG Ally'}
 # ConvertTo-SecureString and Export-Clixml use Windows DPAPI for current-user secrecy.
 ConvertTo-SecureString $reply.token -AsPlainText -Force | Export-Clixml -LiteralPath $credential
 Write-Host 'Paired. Run with -Action Connect to start a visible session.'
 exit
}
if (!(Test-Path -LiteralPath $credential)) { throw 'Pair first using -Action Pair.' }
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
if ($Action -eq 'Disconnect') {
 Write-Host 'Stopping a local live session requires Ctrl+C in its PowerShell window; the server also has owner Stop.'
 exit
}
$session=[guid]::NewGuid().ToString()
Call-Nexus 'start' @{session_id=$session} $token | Out-Null
Write-Host 'Nexus Ally connected (heartbeat only). Keep this visible PowerShell window open.'
Write-Host 'Press Ctrl+C to disconnect. No remote screen/control is implemented in this phase.'
try {
 while ($true) {
  Start-Sleep -Seconds 3
  $result=Call-Nexus 'poll' @{session_id=$session} $token
  if (-not $result.active) { break }
 }
} finally {
 try { Call-Nexus 'disconnect' @{session_id=$session} $token | Out-Null } catch {}
 Write-Host 'Nexus Ally disconnected.'
}
