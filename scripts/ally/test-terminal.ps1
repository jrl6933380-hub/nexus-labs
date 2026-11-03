# Run on Windows PowerShell 5.1. Starts harmless visible child processes; no pairing/network.
$ErrorActionPreference='Stop'
$parseErrors=$null;$parseTokens=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'connect.ps1'),[ref]$parseTokens,[ref]$parseErrors)
if($parseErrors.Count) {throw 'Companion syntax errors.'}
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-NexusTerminal'},$true)
Invoke-Expression $fn.Extent.Text
$r=Invoke-NexusTerminal 'Write-Output "Nexus ready"' 10
if($r.exit_code -ne 0 -or $r.output -notmatch 'Nexus ready' -or $r.timed_out) {throw 'Output receipt failed.'}
$r=Invoke-NexusTerminal 'throw "expected test failure"' 10
if($r.exit_code -eq 0 -or $r.output -notmatch 'expected test failure') {throw 'Error receipt failed.'}
$r=Invoke-NexusTerminal "& cmd.exe /d /c 'exit /b 7'; Write-Output 'finished successfully'" 10
if($r.exit_code -ne 0 -or $r.output -notmatch 'finished successfully') {throw 'Stale native exit code caused a false failure.'}
$r=Invoke-NexusTerminal "& cmd.exe /d /c 'exit /b 7'" 10
if($r.exit_code -ne 7) {throw 'Final native failure exit code was lost.'}
$r=Invoke-NexusTerminal 'Write-Output ("x" * 12000)' 10
if($r.output.Length -gt 6000 -or !$r.truncated) {throw 'Output bound failed.'}
$r=Invoke-NexusTerminal 'Start-Sleep -Seconds 10' 1
if(!$r.timed_out) {throw 'Timeout failed.'}
Write-Host 'PASS: terminal output, failure, native exit status, stale-code regression, truncation and timeout receipts.'
