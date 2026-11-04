# Send only a verified, completed local NexusAds H.264 render to the private owner review queue.
# No posting, publishing, arbitrary URL, arbitrary file paths, or credentials in output.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$ProjectId,
 [string]$RevisionOf='',
 [string]$RevisionToken=''
)
$ErrorActionPreference='Stop'
if($ProjectId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}
$origin='https://nexus-labs-sigma.vercel.app'
$root=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NexusAds'
$project=Join-Path $root $ProjectId
$exports=Join-Path $project 'exports'
foreach($dir in @($root,$project,$exports)){
 if(!(Test-Path -LiteralPath $dir -PathType Container)){throw 'Project directory is missing'}
 if((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked project directories are not allowed'}
}
$configPath=Join-Path $project 'project.json'
if(!(Test-Path -LiteralPath $configPath -PathType Leaf)){throw 'Project manifest missing'}
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$title=[string]$config.name
if(!$title.Trim() -or $title.Length -gt 120){throw 'Invalid project title'}
$chosen=$null
foreach($folder in @(Get-ChildItem -LiteralPath $exports -Directory | Sort-Object Name -Descending)){
 if($folder.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 $receipt=Join-Path $folder.FullName 'result.json'
 $video=Join-Path $folder.FullName 'ad-final.mp4'
 if(!(Test-Path -LiteralPath $receipt -PathType Leaf) -or !(Test-Path -LiteralPath $video -PathType Leaf)){continue}
 if((Get-Item -LiteralPath $video).Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 try{$r=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json}catch{continue}
 if($r.status -ne 'succeeded' -or $r.stage -ne 'complete' -or !$r.verified.h264 -or !$r.verified.decoded -or !$r.verified.silent){continue}
 if($r.video -and ([IO.Path]::GetFullPath([string]$r.video) -ne [IO.Path]::GetFullPath($video))){continue}
 $chosen=@{video=$video;duration_ms=[int]$config.durationMs};break
}
if(!$chosen){throw 'No completed, verified H.264 full-quality render found; render and review the ad first'}
$file=Get-Item -LiteralPath $chosen.video
if($file.Length -lt 128 -or $file.Length -gt 8MB){throw 'Finished MP4 must be 128 bytes to 8 MB for phone review'}
$bytes=[IO.File]::ReadAllBytes($file.FullName)
if([Text.Encoding]::ASCII.GetString($bytes,4,4) -ne 'ftyp'){throw 'Not an MP4 container'}
$sha=[BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential)){throw 'Pair the Ally first'}
# Existing DPAPI credential; never log or pass it to Qwen.
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
function Call-Review([string]$action,[hashtable]$reviewFields){
 # $input is PowerShell's automatic pipeline enumerator, not a safe parameter name.
 $payload=@{action=$action;input=$reviewFields}|ConvertTo-Json -Depth 5 -Compress
 return Invoke-RestMethod -Uri ($origin+'/api/ally-ad-review') -Method POST -ContentType 'application/json' -Headers $headers -Body $payload -TimeoutSec 25
}
$details=@{project_id=$ProjectId;title=$title;bytes=$bytes.Length;sha256=$sha;duration_ms=$chosen.duration_ms}
if($RevisionOf){$details.revision_of=$RevisionOf;$details.revision_token=$RevisionToken}
$reply=Call-Review 'upload_begin' $details
if($reply.status -ne 'uploading'){
 Write-Output ('NEXUS_REVIEW_EXISTS '+$reply.id+' '+$reply.status)
 exit 0
}
$id=[string]$reply.id;$size=[int]$reply.part_bytes
if($id -notmatch '^[a-f0-9]{32}$' -or $size -ne 131072){throw 'Unexpected upload response'}
$count=[int][Math]::Ceiling($bytes.Length/[double]$size)
for($i=0;$i -lt $count;$i++){
 $offset=$i*$size;$length=[Math]::Min($size,$bytes.Length-$offset)
 $encoded=[Convert]::ToBase64String($bytes,$offset,$length)
 $ack=Call-Review 'upload_part' @{id=$id;index=$i;data=$encoded}
 if(!$ack.accepted -or [int]$ack.index -ne $i){throw ('Upload part '+$i+' not confirmed')}
}
$finished=Call-Review 'upload_finish' @{id=$id}
if($finished.review.status -ne 'pending_review'){throw 'Review did not finish uploading'}
Write-Output ('NEXUS_REVIEW_SUBMITTED '+$id)
Write-Output ('PRIVATE_REVIEW_PAGE '+$origin+'/ally-ad-review.html')
){throw 'Invalid project ID'}
if([bool]$RevisionOf -ne [bool]$RevisionToken){throw 'Revision ID and token must be supplied together'}
if($RevisionOf -and ($RevisionOf -notmatch '^[a-f0-9]{32}
$origin='https://nexus-labs-sigma.vercel.app'
$root=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NexusAds'
$project=Join-Path $root $ProjectId
$exports=Join-Path $project 'exports'
foreach($dir in @($root,$project,$exports)){
 if(!(Test-Path -LiteralPath $dir -PathType Container)){throw 'Project directory is missing'}
 if((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked project directories are not allowed'}
}
$configPath=Join-Path $project 'project.json'
if(!(Test-Path -LiteralPath $configPath -PathType Leaf)){throw 'Project manifest missing'}
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$title=[string]$config.name
if(!$title.Trim() -or $title.Length -gt 120){throw 'Invalid project title'}
$chosen=$null
foreach($folder in @(Get-ChildItem -LiteralPath $exports -Directory | Sort-Object Name -Descending)){
 if($folder.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 $receipt=Join-Path $folder.FullName 'result.json'
 $video=Join-Path $folder.FullName 'ad-final.mp4'
 if(!(Test-Path -LiteralPath $receipt -PathType Leaf) -or !(Test-Path -LiteralPath $video -PathType Leaf)){continue}
 if((Get-Item -LiteralPath $video).Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 try{$r=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json}catch{continue}
 if($r.status -ne 'succeeded' -or $r.stage -ne 'complete' -or !$r.verified.h264 -or !$r.verified.decoded -or !$r.verified.silent){continue}
 if($r.video -and ([IO.Path]::GetFullPath([string]$r.video) -ne [IO.Path]::GetFullPath($video))){continue}
 $chosen=@{video=$video;duration_ms=[int]$config.durationMs};break
}
if(!$chosen){throw 'No completed, verified H.264 full-quality render found; render and review the ad first'}
$file=Get-Item -LiteralPath $chosen.video
if($file.Length -lt 128 -or $file.Length -gt 8MB){throw 'Finished MP4 must be 128 bytes to 8 MB for phone review'}
$bytes=[IO.File]::ReadAllBytes($file.FullName)
if([Text.Encoding]::ASCII.GetString($bytes,4,4) -ne 'ftyp'){throw 'Not an MP4 container'}
$sha=[BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential)){throw 'Pair the Ally first'}
# Existing DPAPI credential; never log or pass it to Qwen.
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
function Call-Review([string]$action,[hashtable]$reviewFields){
 # $input is PowerShell's automatic pipeline enumerator, not a safe parameter name.
 $payload=@{action=$action;input=$reviewFields}|ConvertTo-Json -Depth 5 -Compress
 return Invoke-RestMethod -Uri ($origin+'/api/ally-ad-review') -Method POST -ContentType 'application/json' -Headers $headers -Body $payload -TimeoutSec 25
}
$reply=Call-Review 'upload_begin' @{project_id=$ProjectId;title=$title;bytes=$bytes.Length;sha256=$sha;duration_ms=$chosen.duration_ms}
if($reply.status -ne 'uploading'){
 Write-Output ('NEXUS_REVIEW_EXISTS '+$reply.id+' '+$reply.status)
 exit 0
}
$id=[string]$reply.id;$size=[int]$reply.part_bytes
if($id -notmatch '^[a-f0-9]{32}$' -or $size -ne 131072){throw 'Unexpected upload response'}
$count=[int][Math]::Ceiling($bytes.Length/[double]$size)
for($i=0;$i -lt $count;$i++){
 $offset=$i*$size;$length=[Math]::Min($size,$bytes.Length-$offset)
 $encoded=[Convert]::ToBase64String($bytes,$offset,$length)
 $ack=Call-Review 'upload_part' @{id=$id;index=$i;data=$encoded}
 if(!$ack.accepted -or [int]$ack.index -ne $i){throw ('Upload part '+$i+' not confirmed')}
}
$finished=Call-Review 'upload_finish' @{id=$id}
if($finished.review.status -ne 'pending_review'){throw 'Review did not finish uploading'}
Write-Output ('NEXUS_REVIEW_SUBMITTED '+$id)
Write-Output ('PRIVATE_REVIEW_PAGE '+$origin+'/ally-ad-review.html')
 -or $RevisionToken -notmatch '^[a-f0-9-]{36}
$origin='https://nexus-labs-sigma.vercel.app'
$root=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NexusAds'
$project=Join-Path $root $ProjectId
$exports=Join-Path $project 'exports'
foreach($dir in @($root,$project,$exports)){
 if(!(Test-Path -LiteralPath $dir -PathType Container)){throw 'Project directory is missing'}
 if((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked project directories are not allowed'}
}
$configPath=Join-Path $project 'project.json'
if(!(Test-Path -LiteralPath $configPath -PathType Leaf)){throw 'Project manifest missing'}
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$title=[string]$config.name
if(!$title.Trim() -or $title.Length -gt 120){throw 'Invalid project title'}
$chosen=$null
foreach($folder in @(Get-ChildItem -LiteralPath $exports -Directory | Sort-Object Name -Descending)){
 if($folder.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 $receipt=Join-Path $folder.FullName 'result.json'
 $video=Join-Path $folder.FullName 'ad-final.mp4'
 if(!(Test-Path -LiteralPath $receipt -PathType Leaf) -or !(Test-Path -LiteralPath $video -PathType Leaf)){continue}
 if((Get-Item -LiteralPath $video).Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 try{$r=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json}catch{continue}
 if($r.status -ne 'succeeded' -or $r.stage -ne 'complete' -or !$r.verified.h264 -or !$r.verified.decoded -or !$r.verified.silent){continue}
 if($r.video -and ([IO.Path]::GetFullPath([string]$r.video) -ne [IO.Path]::GetFullPath($video))){continue}
 $chosen=@{video=$video;duration_ms=[int]$config.durationMs};break
}
if(!$chosen){throw 'No completed, verified H.264 full-quality render found; render and review the ad first'}
$file=Get-Item -LiteralPath $chosen.video
if($file.Length -lt 128 -or $file.Length -gt 8MB){throw 'Finished MP4 must be 128 bytes to 8 MB for phone review'}
$bytes=[IO.File]::ReadAllBytes($file.FullName)
if([Text.Encoding]::ASCII.GetString($bytes,4,4) -ne 'ftyp'){throw 'Not an MP4 container'}
$sha=[BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential)){throw 'Pair the Ally first'}
# Existing DPAPI credential; never log or pass it to Qwen.
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
function Call-Review([string]$action,[hashtable]$reviewFields){
 # $input is PowerShell's automatic pipeline enumerator, not a safe parameter name.
 $payload=@{action=$action;input=$reviewFields}|ConvertTo-Json -Depth 5 -Compress
 return Invoke-RestMethod -Uri ($origin+'/api/ally-ad-review') -Method POST -ContentType 'application/json' -Headers $headers -Body $payload -TimeoutSec 25
}
$reply=Call-Review 'upload_begin' @{project_id=$ProjectId;title=$title;bytes=$bytes.Length;sha256=$sha;duration_ms=$chosen.duration_ms}
if($reply.status -ne 'uploading'){
 Write-Output ('NEXUS_REVIEW_EXISTS '+$reply.id+' '+$reply.status)
 exit 0
}
$id=[string]$reply.id;$size=[int]$reply.part_bytes
if($id -notmatch '^[a-f0-9]{32}$' -or $size -ne 131072){throw 'Unexpected upload response'}
$count=[int][Math]::Ceiling($bytes.Length/[double]$size)
for($i=0;$i -lt $count;$i++){
 $offset=$i*$size;$length=[Math]::Min($size,$bytes.Length-$offset)
 $encoded=[Convert]::ToBase64String($bytes,$offset,$length)
 $ack=Call-Review 'upload_part' @{id=$id;index=$i;data=$encoded}
 if(!$ack.accepted -or [int]$ack.index -ne $i){throw ('Upload part '+$i+' not confirmed')}
}
$finished=Call-Review 'upload_finish' @{id=$id}
if($finished.review.status -ne 'pending_review'){throw 'Review did not finish uploading'}
Write-Output ('NEXUS_REVIEW_SUBMITTED '+$id)
Write-Output ('PRIVATE_REVIEW_PAGE '+$origin+'/ally-ad-review.html')
)){throw 'Invalid revision authorization'}
$origin='https://nexus-labs-sigma.vercel.app'
$root=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NexusAds'
$project=Join-Path $root $ProjectId
$exports=Join-Path $project 'exports'
foreach($dir in @($root,$project,$exports)){
 if(!(Test-Path -LiteralPath $dir -PathType Container)){throw 'Project directory is missing'}
 if((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked project directories are not allowed'}
}
$configPath=Join-Path $project 'project.json'
if(!(Test-Path -LiteralPath $configPath -PathType Leaf)){throw 'Project manifest missing'}
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$title=[string]$config.name
if(!$title.Trim() -or $title.Length -gt 120){throw 'Invalid project title'}
$chosen=$null
foreach($folder in @(Get-ChildItem -LiteralPath $exports -Directory | Sort-Object Name -Descending)){
 if($folder.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 $receipt=Join-Path $folder.FullName 'result.json'
 $video=Join-Path $folder.FullName 'ad-final.mp4'
 if(!(Test-Path -LiteralPath $receipt -PathType Leaf) -or !(Test-Path -LiteralPath $video -PathType Leaf)){continue}
 if((Get-Item -LiteralPath $video).Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
 try{$r=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json}catch{continue}
 if($r.status -ne 'succeeded' -or $r.stage -ne 'complete' -or !$r.verified.h264 -or !$r.verified.decoded -or !$r.verified.silent){continue}
 if($r.video -and ([IO.Path]::GetFullPath([string]$r.video) -ne [IO.Path]::GetFullPath($video))){continue}
 $chosen=@{video=$video;duration_ms=[int]$config.durationMs};break
}
if(!$chosen){throw 'No completed, verified H.264 full-quality render found; render and review the ad first'}
$file=Get-Item -LiteralPath $chosen.video
if($file.Length -lt 128 -or $file.Length -gt 8MB){throw 'Finished MP4 must be 128 bytes to 8 MB for phone review'}
$bytes=[IO.File]::ReadAllBytes($file.FullName)
if([Text.Encoding]::ASCII.GetString($bytes,4,4) -ne 'ftyp'){throw 'Not an MP4 container'}
$sha=[BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
$credential=Join-Path $env:LOCALAPPDATA 'NexusAlly\device-token.xml'
if(!(Test-Path -LiteralPath $credential)){throw 'Pair the Ally first'}
# Existing DPAPI credential; never log or pass it to Qwen.
$secure=Import-Clixml -LiteralPath $credential
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$headers=@{Authorization='Bearer '+$token}
function Call-Review([string]$action,[hashtable]$reviewFields){
 # $input is PowerShell's automatic pipeline enumerator, not a safe parameter name.
 $payload=@{action=$action;input=$reviewFields}|ConvertTo-Json -Depth 5 -Compress
 return Invoke-RestMethod -Uri ($origin+'/api/ally-ad-review') -Method POST -ContentType 'application/json' -Headers $headers -Body $payload -TimeoutSec 25
}
$reply=Call-Review 'upload_begin' @{project_id=$ProjectId;title=$title;bytes=$bytes.Length;sha256=$sha;duration_ms=$chosen.duration_ms}
if($reply.status -ne 'uploading'){
 Write-Output ('NEXUS_REVIEW_EXISTS '+$reply.id+' '+$reply.status)
 exit 0
}
$id=[string]$reply.id;$size=[int]$reply.part_bytes
if($id -notmatch '^[a-f0-9]{32}$' -or $size -ne 131072){throw 'Unexpected upload response'}
$count=[int][Math]::Ceiling($bytes.Length/[double]$size)
for($i=0;$i -lt $count;$i++){
 $offset=$i*$size;$length=[Math]::Min($size,$bytes.Length-$offset)
 $encoded=[Convert]::ToBase64String($bytes,$offset,$length)
 $ack=Call-Review 'upload_part' @{id=$id;index=$i;data=$encoded}
 if(!$ack.accepted -or [int]$ack.index -ne $i){throw ('Upload part '+$i+' not confirmed')}
}
$finished=Call-Review 'upload_finish' @{id=$id}
if($finished.review.status -ne 'pending_review'){throw 'Review did not finish uploading'}
Write-Output ('NEXUS_REVIEW_SUBMITTED '+$id)
Write-Output ('PRIVATE_REVIEW_PAGE '+$origin+'/ally-ad-review.html')
