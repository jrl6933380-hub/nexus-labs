# Read-only Google browser adapter. Never executes page instructions or touches credentials.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('Open','Capture')][string]$Action,
 [Parameter(Mandatory=$true)][string]$Url
)
$ErrorActionPreference='Stop'
# Node reads UTF-8. Windows' legacy OEM encoding can turn UI glyphs into control bytes.
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$OutputEncoding=[Console]::OutputEncoding
$uri=[Uri]$Url
if($uri.Scheme -ne 'https' -or $uri.Host -ne 'www.google.com' -or $uri.UserInfo -or
 ($uri.AbsolutePath -ne '/search' -and $uri.AbsolutePath -ne '/maps/search/')){throw 'Only generated Google Search and Maps search URLs are supported.'}
if($Action -eq 'Open'){
 $edge=Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
 if(!(Test-Path -LiteralPath $edge)){$edge=Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'}
 if(!(Test-Path -LiteralPath $edge)){throw 'Microsoft Edge is unavailable.'}
 Start-Process -FilePath $edge -ArgumentList @('--new-window',('"'+$Url+'"'))
 @{opened=$true}|ConvertTo-Json -Compress
 exit
}
Add-Type -AssemblyName UIAutomationClient
function ValueOf($element){
 $pattern=$null
 if($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){return $pattern.Current.Value}
 $pattern=$null
 if($element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$pattern)){return $pattern.Current.Value}
 return ''
}
function GetQuery($address){
 $u=[Uri]$address
 $parts=@{}
 foreach($piece in $u.Query.TrimStart('?').Split('&')){
  $pair=$piece.Split('=',2)
  if($pair.Length -eq 2){$parts[$pair[0]]=[Uri]::UnescapeDataString($pair[1].Replace('+',' '))}
 }
 if($parts.ContainsKey('q')){return $parts['q']}
 if($parts.ContainsKey('query')){return $parts['query']}
 return ''
}
$expected=GetQuery $Url
if(!$expected){throw 'Search query is required.'}
$root=[System.Windows.Automation.AutomationElement]::RootElement
$windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
foreach($window in $windows){
 if($window.Current.ClassName -ne 'Chrome_WidgetWin_1'){continue}
 if($window.Current.Name -eq 'Nexus Ally · Command Deck'){continue}
 $edits=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
 $matched=$false;$requiredPlace='';$requiredCity=''
 foreach($edit in $edits){
  if($edit.Current.AutomationId -notlike 'view_*' -and $edit.Current.Name -ne 'Address and search bar'){continue}
  $address=ValueOf $edit
  try{
   if($address -notmatch '^https?://'){$address='https://'+$address}
   $actual=[Uri]$address
   if($actual.Host -ne 'www.google.com'){continue}
   if((GetQuery $address) -ne $expected){
    # Maps replaces search URLs with a place URL. Require exact place-name prefix
    # plus the requested city in the document before accepting that redirect.
    if($uri.AbsolutePath -notlike '/maps/*' -or $actual.AbsolutePath -notmatch '^/maps/place/([^/]+)/'){continue}
    $placeName=[Uri]::UnescapeDataString($Matches[1].Replace('+',' '))
    if(!$expected.StartsWith($placeName+' ',[StringComparison]::OrdinalIgnoreCase)){continue}
    $requiredPlace=$placeName
    $requiredCity=$expected.Substring($placeName.Length+1).Split(',')[0].Trim()
    if(!$requiredCity){continue}
   }
   # AI Mode and ordinary Search cannot satisfy each other's capture request.
   if(($uri.Query -match 'udm=50') -ne ($actual.Query -match 'udm=50')){continue}
   if(($uri.AbsolutePath -like '/maps/*') -ne ($actual.AbsolutePath -like '/maps/*')){continue}
   $matched=$true;break
  }catch{continue}
 }
 if(!$matched){continue}
 $documents=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document)))
 foreach($document in $documents){
  $pattern=$null
  if(!$document.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){continue}
  $text=$pattern.DocumentRange.GetText(22000)
  if($text.Length -lt 100){continue}
  if($requiredPlace -and ($text -notmatch [Regex]::Escape($requiredPlace) -or $text -notmatch [Regex]::Escape($requiredCity))){continue}
  # Strip the account chrome; personal account identity is never written into batches.
  $text=$text -replace '(?im)^Google Account:.*$','[account header removed]'
  $text=$text -replace '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[email removed]'
  $links=@()
  $items=$document.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Hyperlink)))
  foreach($item in $items){
   $href=ValueOf $item
   if($href -match '^https://'){$links+=@{name=$item.Current.Name;url=$href}}
   if($links.Count -ge 60){break}
  }
  @{found=$true;url=$Url;actual_url=$address;text=$text;links=@($links);captured_at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 5 -Compress
  exit
 }
}
@{found=$false;reason='Expected Google page not available. Keep its window open.'}|ConvertTo-Json -Compress
