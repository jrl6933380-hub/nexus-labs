# Nexus Ally v0.3 — interactive heartbeat and owner-requested screenshots.
# No remote keyboard, mouse, shell, or auto-start.
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
Write-Host 'Nexus Ally connected (read-only screen requests enabled). Keep this visible PowerShell window open.'
Write-Host 'Press Ctrl+C to disconnect. Screen requests require this visible window; no keyboard/control actions.'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexusAllyInput {
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint dx,uint dy,int data,UIntPtr extra);
 public static void Click(int x,int y) { SetCursorPos(x,y); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
 public static void Scroll(int delta) { mouse_event(0x0800,0,0,delta,UIntPtr.Zero); }
}
'@

function Capture-Jpeg {
 $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
 if($bounds.Width -lt 1 -or $bounds.Height -lt 1){throw 'No interactive display.'}
 $scale=[Math]::Min(1.0,1280.0/$bounds.Width)
 $w=[Math]::Max(1,[int]($bounds.Width*$scale)); $h=[Math]::Max(1,[int]($bounds.Height*$scale))
 $original=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
 $graphic=[System.Drawing.Graphics]::FromImage($original)
 try {$graphic.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size)} finally {$graphic.Dispose()}
 $small=New-Object System.Drawing.Bitmap($original,$w,$h);$original.Dispose()
 $stream=New-Object System.IO.MemoryStream
 try {$small.Save($stream,[System.Drawing.Imaging.ImageFormat]::Jpeg);return [Convert]::ToBase64String($stream.ToArray())} finally {$small.Dispose();$stream.Dispose()}
}
$failures=0
try {
 while ($true) {
  Start-Sleep -Seconds 3
  try { $result=Call-Nexus 'poll' @{session_id=$session} $token; $failures=0 }
  catch { $failures++;Write-Warning ('Nexus response failed '+$failures+'/3; retrying.');if($failures -ge 3){throw 'Connection interrupted. Restart Connect to resume.'};Start-Sleep -Seconds ([Math]::Min(5,$failures*2));continue }
  if (-not $result.active) { break }
  if ($result.command -and $result.command.action -eq 'screen') {
   try {
    $image=Capture-Jpeg
    if ($image.Length -le 450000) { Call-Nexus 'complete_screen' @{session_id=$session;command_id=$result.command.command_id;image_base64=$image} $token | Out-Null }
    else { Write-Warning 'Screen too large to transmit; request expires.' }
   } catch { Write-Warning 'Screen capture failed; request expires.' }
  } elseif ($result.command) {
   $cmd=$result.command
   $receipt=@{ok=$true}
   try {
    if (-not [Environment]::UserInteractive) { throw 'Interactive desktop required.' }
    switch ($cmd.action) {
     'status' { $receipt.data=@{host=$env:COMPUTERNAME;version='0.3';session='interactive'} }
     'qwen_status' {
      try {$response=Invoke-WebRequest -Uri 'http://127.0.0.1:9931/health' -UseBasicParsing -TimeoutSec 3;$receipt.data=@{reachable=$true;status=[int]$response.StatusCode}}
      catch {$receipt.data=@{reachable=$false}} }
     'storage' { $drives=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{drive=$_.DeviceID;free_bytes=[long]$_.FreeSpace;total_bytes=[long]$_.Size} });$receipt.data=@{drives=$drives;read_only=$true} }
     'open_notepad' { Start-Process notepad.exe | Out-Null }
     'click' { $b=[System.Windows.Forms.SystemInformation]::VirtualScreen;[NexusAllyInput]::Click([int]($b.Left+$cmd.x*($b.Width-1)),[int]($b.Top+$cmd.y*($b.Height-1))) }
     'scroll' { [NexusAllyInput]::Scroll([int]$cmd.dy) }
     'type' {
      if($cmd.text -match '(?i)password|api.key|secret|token') {throw 'Sensitive text not supported.'}
      $safe=[regex]::Replace([string]$cmd.text,'[+^%~(){}\[\]]',{param($m) '{'+$m.Value+'}'})
      [System.Windows.Forms.SendKeys]::SendWait($safe) }
     'key' { $map=@{Tab='{TAB}';Escape='{ESC}';ArrowUp='{UP}';ArrowDown='{DOWN}';ArrowLeft='{LEFT}';ArrowRight='{RIGHT}';Backspace='{BACKSPACE}'};if(-not $map.ContainsKey([string]$cmd.key)) {throw 'Key not allowed.'};[System.Windows.Forms.SendKeys]::SendWait($map[[string]$cmd.key]) }
     default {throw 'Unsupported action.'}
    }
   } catch {$receipt=@{ok=$false;error='Action failed or refused on Ally.'}}
   try { Call-Nexus 'complete_command' @{session_id=$session;command_id=$cmd.command_id;result=$receipt} $token | Out-Null }
   catch {Write-Warning 'Receipt could not be delivered; do not blindly replay.'}
  }
 }
} finally {
 try { Call-Nexus 'disconnect' @{session_id=$session} $token | Out-Null } catch {}
 Write-Host 'Nexus Ally disconnected.'
}
