# Nexus Ally: read-only storage inventory. Windows PowerShell 5.1+.
# This script never deletes, changes, uploads, or transmits files.
[CmdletBinding()]
param(
  [ValidateRange(1,100)][int]$Top = 15,
  [ValidateRange(1,50000)][int]$ScanLimit = 10000
)
$ErrorActionPreference = 'Continue'
function Try-Bytes($file) {
  try { return [long]$file.Length } catch { return 0 }
}
function Inspect-Folder([string]$label, [string]$path) {
  if ([string]::IsNullOrWhiteSpace($path) -or !(Test-Path -LiteralPath $path -PathType Container)) {
    return [ordered]@{ name=$label; exists=$false; path=$path; sampledFiles=0; sizeBytesSampled=0; truncated=$false; topFiles=@() }
  }
  $count = 0
  $total = [long]0
  $items = New-Object 'System.Collections.Generic.List[object]'
  $errors = 0
  try {
    # Enumerate incrementally. Never follow reparse points/junctions to other volumes.
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push($path)
    while ($stack.Count -gt 0 -and $count -lt $ScanLimit) {
      $dir = $stack.Pop()
      try {
        foreach ($file in [System.IO.Directory]::EnumerateFiles($dir)) {
          if ($count -ge $ScanLimit) { break }
          try {
            $info = New-Object System.IO.FileInfo($file)
            $size = Try-Bytes $info
            $count++
            $total += $size
            $items.Add([pscustomobject]@{ path=$info.FullName; bytes=$size })
          } catch { $errors++ }
        }
      } catch { $errors++ }
      if ($count -ge $ScanLimit) { break }
      try {
        foreach ($sub in [System.IO.Directory]::EnumerateDirectories($dir)) {
          try {
            $attr = [System.IO.File]::GetAttributes($sub)
            if (($attr -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) { $stack.Push($sub) }
          } catch { $errors++ }
        }
      } catch { $errors++ }
    }
  } catch { $errors++ }
  return [ordered]@{
    name=$label; exists=$true; path=$path; sampledFiles=$count
    sizeBytesSampled=$total; truncated=($count -ge $ScanLimit)
    errors=$errors
    topFiles=@($items | Sort-Object bytes -Descending | Select-Object -First $Top)
  }
}
$drives = @()
try {
  $drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [ordered]@{ drive=$_.DeviceID; totalBytes=[long]$_.Size; freeBytes=[long]$_.FreeSpace }
  })
} catch {}
$home = [Environment]::GetFolderPath('UserProfile')
$paths = @(
  @{label='Downloads';path=(Join-Path $home 'Downloads')},
  @{label='Desktop';path=[Environment]::GetFolderPath('Desktop')},
  @{label='Temporary files (user)';path=$env:TEMP},
  @{label='Hugging Face cache';path=(Join-Path $home '.cache\huggingface')},
  @{label='Recycle Bin (current drive, inventory only)';path=$null}
)
$folders = @($paths | Where-Object { $_.path } | ForEach-Object { Inspect-Folder $_.label $_.path })
$report = [ordered]@{
  schema='nexus.ally.storage.v1'
  generatedUtc=[DateTime]::UtcNow.ToString('o')
  readOnly=$true
  machine=$env:COMPUTERNAME
  drives=$drives
  folders=$folders
  cautions=@('Sampled file sizes are not full folder totals when truncated.','Do not delete model weights, game saves, or downloads without review.','This script does not include hidden Windows system directories.')
}
$report | ConvertTo-Json -Depth 8
