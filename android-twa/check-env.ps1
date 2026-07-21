#requires -Version 5.1
<#
.SYNOPSIS
  Read-only toolchain check for building the Card Majlis Android TWA (Stage 33.3).

.DESCRIPTION
  Verifies the owner machine has what `bubblewrap init` + `gradlew.bat assembleDebug`
  need. It ONLY reads versions and paths — it installs nothing, downloads nothing,
  and writes nothing. Run it before the build runbook in README.md.

  Exit code: 0 if no FAIL lines, 1 if any hard requirement failed (WARN does not fail).

.EXAMPLE
  cd android-twa
  .\check-env.ps1
#>

$ErrorActionPreference = 'SilentlyContinue'
$fail = 0
$warn = 0

function Write-Result {
  param([ValidateSet('PASS', 'WARN', 'FAIL')][string]$Status, [string]$Name, [string]$Detail)
  $color = switch ($Status) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } }
  Write-Host ('[{0}] ' -f $Status) -ForegroundColor $color -NoNewline
  Write-Host ('{0,-16} {1}' -f $Name, $Detail)
  if ($Status -eq 'FAIL') { $script:fail++ }
  if ($Status -eq 'WARN') { $script:warn++ }
}

function Test-Cmd { param([string]$Name) [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

Write-Host ''
Write-Host 'Card Majlis - Android TWA environment check (read-only)' -ForegroundColor Cyan
Write-Host '=======================================================' -ForegroundColor Cyan

# --- Java / JDK 17+ (required by Bubblewrap + Android Gradle Plugin) ---
if (Test-Cmd 'java') {
  # `java -version` prints to stderr; in PS 5.1 with EAP=SilentlyContinue, a
  # PowerShell 2>&1 merge drops the wrapped ErrorRecords. Route through cmd so
  # we get the plain text regardless of ErrorActionPreference.
  $raw = (cmd /c "java -version 2>&1") -join "`n"
  $m = [regex]::Match($raw, 'version "(\d+)(?:\.(\d+))?')
  if ($m.Success) {
    $major = [int]$m.Groups[1].Value
    if ($major -eq 1) { $major = [int]$m.Groups[2].Value }  # legacy "1.8" scheme
    if ($major -ge 17) { Write-Result PASS 'JDK'   "Java $major (>= 17)" }
    else { Write-Result FAIL 'JDK' "Java $major found; need JDK 17+ (Temurin/Zulu/Android Studio JBR)" }
  }
  else { Write-Result WARN 'JDK' "java present but version unparsable: $($raw -split "`n" | Select-Object -First 1)" }
}
else { Write-Result FAIL 'JDK' 'java not on PATH; install JDK 17+ (e.g. Temurin 17)' }

# --- Android SDK ---
$sdk = $env:ANDROID_HOME; if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if ($sdk -and (Test-Path $sdk)) { Write-Result PASS 'Android SDK' $sdk }
elseif ($sdk) { Write-Result WARN 'Android SDK' "ANDROID_HOME/SDK_ROOT set but missing: $sdk" }
else { Write-Result WARN 'Android SDK' 'ANDROID_HOME/ANDROID_SDK_ROOT unset (Bubblewrap can install an SDK on first run)' }

# --- adb (needed to install the debug APK on a device) ---
if (Test-Cmd 'adb') {
  $v = ((& adb version 2>&1) | Select-Object -First 1)
  Write-Result PASS 'adb' $v
}
else { Write-Result WARN 'adb' 'adb not on PATH; needed only to install on a device (comes with platform-tools)' }

# --- Node / npm ---
if (Test-Cmd 'node') { Write-Result PASS 'node' (& node -v) } else { Write-Result FAIL 'node' 'node not on PATH (Node 18+; project prefers Node 22)' }
if (Test-Cmd 'npm')  { Write-Result PASS 'npm'  (& npm -v) }  else { Write-Result FAIL 'npm'  'npm not on PATH' }

# --- Bubblewrap CLI (global or via npx) ---
if (Test-Cmd 'bubblewrap') {
  Write-Result PASS 'Bubblewrap' ('global: ' + (& bubblewrap --version 2>&1 | Select-Object -First 1))
}
else {
  Write-Result WARN 'Bubblewrap' 'not global; use "npx @bubblewrap/cli@latest ..." or "npm i -g @bubblewrap/cli"'
}

# --- twa-manifest.json sanity (read-only) ---
$manifestPath = Join-Path $PSScriptRoot 'twa-manifest.json'
if (Test-Path $manifestPath) {
  try {
    $twa = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
    Write-Result PASS 'twa-manifest' ("packageId=$($twa.packageId) host=$($twa.host)")
  }
  catch { Write-Result FAIL 'twa-manifest' "invalid JSON: $($_.Exception.Message)" }
}
else { Write-Result FAIL 'twa-manifest' "missing $manifestPath" }

# --- Summary ---
Write-Host '-------------------------------------------------------'
if ($fail -eq 0) { Write-Host ("READY - {0} warning(s). Proceed with the README build runbook." -f $warn) -ForegroundColor Green }
else { Write-Host ("NOT READY - {0} failure(s), {1} warning(s). Fix the FAIL lines first." -f $fail, $warn) -ForegroundColor Red }
Write-Host ''

exit ([int]($fail -gt 0))
