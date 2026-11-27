# ---------------------------------------------------------------------------
# Registers (or re-registers) a daily Windows scheduled task that copies the
# PRODUCTION database to this computer (Stage 44.3):
#
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-local-backup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-local-backup.ps1 -Remove
#
# The task runs `npm run db:backup:local` in the project folder every day at
# -At (default 12:00). If the computer was off at that time, it runs as soon
# as it is on again (StartWhenAvailable). Output is appended to
# .data\prod-backups\backup.log. Needs .env.production.local with DATABASE_URL.
# Runs as the current user, only while signed in (no stored password).
# ---------------------------------------------------------------------------
param(
  [string]$At = '12:00',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$TaskName = 'CardMajlis-DB-Backup'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task $TaskName."
  return
}

$project = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $project '.env.production.local'))) {
  throw ".env.production.local not found in $project (it must hold DATABASE_URL)."
}
$npm = (Get-Command npm.cmd).Source
$logDir = Join-Path $project '.data\prod-backups'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'backup.log'

$cmd = "cd /d `"$project`" && `"$npm`" run -s db:backup:local >> `"$log`" 2>&1"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $cmd" -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Card Majlis: daily copy of the production database to .data\prod-backups (30 days kept).' -Force | Out-Null
Write-Output "Scheduled $TaskName daily at $At (log: $log)."
