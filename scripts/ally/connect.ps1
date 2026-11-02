# Nexus Ally v0.4.0 — visible, owner-requested screenshots and bounded controls.
# No arbitrary shell or auto-start.
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
 return Invoke-RestMethod -Uri ($Origin+'/api/ally') -Method POST -ContentType 'application/json' -Headers $headers -Body (@{action=$method}+$data | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 12
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
Call-Nexus 'start' @{session_id=$session;capabilities=@('terminal','self_update')} $token | Out-Null
Write-Host 'Nexus Ally connected (screenshots and bounded controls enabled). Keep this visible PowerShell window open.'
Write-Host 'Press Ctrl+C to disconnect. Owner terminal tools are enabled; commands run visibly as your Windows user.'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexusAllyInput {
 [DllImport("user32.dll", SetLastError=true)] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
 public static IntPtr BeginPhysicalCoordinates() {
  IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
  if(previous==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  return previous;
 }
 public static void EndPhysicalCoordinates(IntPtr previous) { SetThreadDpiAwarenessContext(previous); }
 [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint dx,uint dy,int data,UIntPtr extra);
 public static void Click(double x,double y) {
  IntPtr previous=BeginPhysicalCoordinates();
  try {
   int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
   if(width<1 || height<1) throw new InvalidOperationException("No interactive display.");
   if(!SetCursorPos(left+(int)(x*(width-1)),top+(int)(y*(height-1)))) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero);
  } finally { EndPhysicalCoordinates(previous); }
 }
 public static void Scroll(int delta) { mouse_event(0x0800,0,0,delta,UIntPtr.Zero); }
}
'@

function Capture-Jpeg {
 $previousDpi=[NexusAllyInput]::BeginPhysicalCoordinates()
 try {
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
 } finally { [NexusAllyInput]::EndPhysicalCoordinates($previousDpi) }
}
# Each command runs in a separate visible, non-elevated PowerShell process.
function Invoke-NexusTerminal([string]$script,[int]$timeoutSeconds) {
 $receiptPath=Join-Path ([IO.Path]::GetTempPath()) ('nexus-ally-'+[guid]::NewGuid().ToString()+'.json')
 $script64=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
 $path64=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($receiptPath))
 $wrapper=@'
$ErrorActionPreference='Stop'
$script=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('__SCRIPT__'))
$path=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('__PATH__'))
$output=New-Object Text.StringBuilder
$truncated=$false
$exitCode=0
$global:LASTEXITCODE=0
Write-Host 'Nexus Ally terminal command (owner session)'
function Append-Output($value) {
 $line=[string]$value
 $remaining=6000-$output.Length
 if($remaining -gt 0) {
  $shown=($line+[Environment]::NewLine)
  if($shown.Length -gt $remaining) {$shown=$shown.Substring(0,$remaining);$script:truncated=$true}
  [void]$output.Append($shown)
  Write-Host $shown -NoNewline
 } else {$script:truncated=$true}
}
try {
 & ([scriptblock]::Create($script)) *>&1 | ForEach-Object { Append-Output $_ }
 $exitCode=$global:LASTEXITCODE
} catch { $exitCode=1;Append-Output ($_ | Out-String) }
@{exit_code=$exitCode;output=$output.ToString();truncated=$truncated} | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $path -Encoding UTF8
'@
 $wrapper=$wrapper.Replace('__SCRIPT__',$script64).Replace('__PATH__',$path64)
 $runnerPath=$receiptPath+'.ps1'
 [IO.File]::WriteAllText($runnerPath,$wrapper,[Text.Encoding]::UTF8)
 Write-Host ('Running owner terminal command: '+$script)
 $process=$null
 try {
  $process=Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$runnerPath+'"')) -WorkingDirectory $env:USERPROFILE -PassThru
  if(-not $process.WaitForExit($timeoutSeconds*1000)) {
   & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
   return @{exit_code=$null;output='Command timed out. Inspect state before retrying; changes may have occurred.';truncated=$false;timed_out=$true}
  }
  if(!(Test-Path -LiteralPath $receiptPath)) {throw 'Terminal ended without a receipt.'}
  if((Get-Item -LiteralPath $receiptPath).Length -gt 60000) {throw 'Terminal receipt too large.'}
  $r=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  Write-Host ([string]$r.output)
  return @{exit_code=$r.exit_code;output=[string]$r.output;truncated=[bool]$r.truncated;timed_out=$false}
 } finally {
  if($process) {
   if(-not $process.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null }
   $process.Dispose()
  }
  Remove-Item -LiteralPath $receiptPath,$runnerPath -Force -ErrorAction SilentlyContinue
 }
}
function Stage-NexusCompanion([string]$revision,[string]$sha256) {
 if($revision -notmatch '^[a-f0-9]{40}$' -or $sha256 -notmatch '^[a-f0-9]{64}$') {throw 'Pinned source required.'}
 $updates=Join-Path $base 'updates'
 [void](New-Item -ItemType Directory -Path $updates -Force)
 $path=Join-Path $updates ('connect-'+[guid]::NewGuid().ToString()+'.ps1')
 try {
  $uri='https://raw.githubusercontent.com/jrl6933380-hub/nexus-labs/'+$revision+'/scripts/ally/connect.ps1'
  Invoke-WebRequest -Uri $uri -OutFile $path -UseBasicParsing -TimeoutSec 12 -MaximumRedirection 0
  if((Get-Item -LiteralPath $path).Length -gt 100000) {throw 'Companion too large.'}
  if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) {throw 'Companion checksum mismatch.'}
  $parseErrors=$null;$parseTokens=$null
  [void][Management.Automation.Language.Parser]::ParseFile($path,[ref]$parseTokens,[ref]$parseErrors)
  if($parseErrors.Count -gt 0) {throw 'Companion syntax invalid.'}
  return $path
 } catch {
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  throw
 }
}

$restartPath=$null
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
     'status' { $receipt.data=@{host=$env:COMPUTERNAME;version='0.4.0';session='interactive'} }
     'qwen_status' {
      try {$response=Invoke-WebRequest -Uri 'http://127.0.0.1:9931/health' -UseBasicParsing -TimeoutSec 3;$receipt.data=@{reachable=$true;status=[int]$response.StatusCode}}
      catch {$receipt.data=@{reachable=$false}} }
     'storage' { $drives=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{drive=$_.DeviceID;free_bytes=[long]$_.FreeSpace;total_bytes=[long]$_.Size} });$receipt.data=@{drives=$drives;read_only=$true} }
     'terminal' { $receipt.data=Invoke-NexusTerminal ([string]$cmd.script) ([int]$cmd.timeout_seconds);$receipt.ok=($receipt.data.exit_code -eq 0 -and -not $receipt.data.timed_out) }
     'self_update' { $restartPath=Stage-NexusCompanion ([string]$cmd.revision) ([string]$cmd.sha256);$receipt.data=@{staged=$true;revision=$cmd.revision;restart_scheduled=$true} }
     'open_notepad' { Start-Process notepad.exe | Out-Null }
     'click' { [NexusAllyInput]::Click([double]$cmd.x,[double]$cmd.y) }
     'scroll' { [NexusAllyInput]::Scroll([int]$cmd.dy) }
     'type' {
      if($cmd.text -match '(?i)password|api.key|secret|token') {throw 'Sensitive text not supported.'}
      $safe=[regex]::Replace([string]$cmd.text,'[+^%~(){}\[\]]',{param($m) '{'+$m.Value+'}'})
      [System.Windows.Forms.SendKeys]::SendWait($safe) }
     'key' { $map=@{Tab='{TAB}';Escape='{ESC}';ArrowUp='{UP}';ArrowDown='{DOWN}';ArrowLeft='{LEFT}';ArrowRight='{RIGHT}';Backspace='{BACKSPACE}'};if(-not $map.ContainsKey([string]$cmd.key)) {throw 'Key not allowed.'};[System.Windows.Forms.SendKeys]::SendWait($map[[string]$cmd.key]) }
     default {throw 'Unsupported action.'}
    }
   } catch {$receipt=@{ok=$false;error='Action failed or refused on Ally.'}}
   try { Call-Nexus 'complete_command' @{session_id=$session;command_id=$cmd.command_id;result=$receipt} $token | Out-Null;if($restartPath) {break} }
   catch {$restartPath=$null;Write-Warning 'Receipt could not be delivered; do not blindly replay.'}
  }
 }
} finally {
 try { Call-Nexus 'disconnect' @{session_id=$session} $token | Out-Null } catch {}
 Write-Host 'Nexus Ally disconnected.'
}

if($restartPath) {
 Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$restartPath+'"'),'-Action','Connect')
}
