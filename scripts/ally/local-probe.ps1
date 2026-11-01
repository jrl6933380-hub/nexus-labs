# Nexus Ally local capability probe — no network control, no installation.
# Run in an interactive Windows desktop session (PowerShell 5.1+).
[CmdletBinding()]
param(
 [ValidateSet('status','screen')][string]$Action='status',
 [string]$OutputPath=''
)
$ErrorActionPreference='Stop'
function Get-ModelStatus {
 $result=[ordered]@{reachable=$false;endpoint='http://127.0.0.1:9931';httpStatus=$null}
 try {
  $req=[System.Net.HttpWebRequest]::Create('http://127.0.0.1:9931/health')
  $req.Timeout=1500
  $req.ReadWriteTimeout=1500
  $req.Proxy=$null
  $res=$req.GetResponse()
  try { $result.reachable=$true; $result.httpStatus=[int]$res.StatusCode } finally { $res.Close() }
 } catch [System.Net.WebException] {
  if ($_.Exception.Response) {
   $response=$_.Exception.Response
   try { $result.httpStatus=[int]$response.StatusCode; $result.reachable=$true } finally { $response.Close() }
  }
 }
 return $result
}
if ($Action -eq 'status') {
 $os=Get-CimInstance Win32_OperatingSystem
 $result=[ordered]@{
  schema='nexus.ally.local-probe.v1'
  action='status'
  atUtc=[DateTime]::UtcNow.ToString('o')
  windows=$os.Caption
  qwen=(Get-ModelStatus)
  connectedToNexus=$false
  note='This is local diagnostics only. No remote device bridge is active.'
 }
 $result | ConvertTo-Json -Depth 5
 exit
}
if (-not [Environment]::UserInteractive) { throw 'Screenshots require a visible interactive Windows desktop.' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
if ($bounds.Width -lt 1 -or $bounds.Height -lt 1) { throw 'Display dimensions unavailable.' }
if (-not $OutputPath) { $OutputPath=Join-Path $env:TEMP ('nexus-ally-screen-'+[guid]::NewGuid().ToString('N')+'.png') }
$full=[System.IO.Path]::GetFullPath($OutputPath)
$parent=[System.IO.Path]::GetDirectoryName($full)
if (-not [System.IO.Directory]::Exists($parent)) { throw 'Output directory must already exist.' }
$bmp=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
$gfx=[System.Drawing.Graphics]::FromImage($bmp)
try {
 $gfx.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size)
 $bmp.Save($full,[System.Drawing.Imaging.ImageFormat]::Png)
} finally {
 $gfx.Dispose()
 $bmp.Dispose()
}
[ordered]@{schema='nexus.ally.local-probe.v1'; action='screen';file=$full;width=$bounds.Width;height=$bounds.Height;private=$true;warning='This screenshot may contain sensitive information. Keep it local and delete it after reviewing.'} | ConvertTo-Json
