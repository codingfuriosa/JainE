<#
  Registers sheet-bot as a Scheduled Task that starts "node src/index.js" at logon,
  under the current user -- NOT a Windows Service. A CDP-driven Chrome window needs
  an interactive desktop session, and Windows Service accounts don't get one (Session
  0 isolation), so a logon task is the correct choice here, the same reason
  tools/erp-bot's README gives for watch-erp.ps1.

  Run this once, from this directory, in an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File install-task.ps1
#>

$ErrorActionPreference = 'Stop'

$sheetBotDir = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source

$action = New-ScheduledTaskAction -Execute $nodePath -Argument 'src/index.js' -WorkingDirectory $sheetBotDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'JainE-SheetBot' -Action $action -Trigger $trigger -Settings $settings -Description 'Appends booking data to a Google Sheet via CDP when a JAIN-E Booking Form is processed. See tools/sheet-bot/README.md.' -Force

Write-Host "Registered task 'JainE-SheetBot'. It starts at your next logon."
Write-Host "To start it right now without logging off: Start-ScheduledTask -TaskName 'JainE-SheetBot'"
Write-Host "To check on it: Get-ScheduledTask -TaskName 'JainE-SheetBot' | Get-ScheduledTaskInfo"
