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

# --- Read-only detection of an Android Studio toolchain that isn't on PATH (Stage 33.14) ---
# The machine may have a usable JDK/SDK installed via Android Studio without any env vars.
# We only DETECT and REPORT candidates + the vars to set — we never write env vars.
$asStudioJbr   = "$env:ProgramFiles\Android\Android Studio\jbr"
$asJbrJava     = Join-Path $asStudioJbr 'bin\java.exe'
$sdkCandidates = @("$env:LOCALAPPDATA\Android\Sdk", "$env:ProgramFiles\Android\Sdk") | Where-Object { $_ }
$detectedSdk   = $sdkCandidates | Where-Object { Test-Path (Join-Path $_ 'platform-tools\adb.exe') } | Select-Object -First 1

function Get-JavaMajor([string]$exe) {
  # `java -version` prints to stderr; route through cmd for EAP-independent capture.
  $raw = (cmd /c "`"$exe`" -version 2>&1") -join "`n"
  $m = [regex]::Match($raw, 'version "(\d+)(?:\.(\d+))?')
  if (-not $m.Success) { return 0 }
  $mj = [int]$m.Groups[1].Value
  if ($mj -eq 1) { $mj = [int]$m.Groups[2].Value }   # legacy "1.8" scheme
  return $mj
}

# --- Java / JDK 17+ (required by Bubblewrap + Android Gradle Plugin) ---
$jdkOk = $false
if (Test-Cmd 'java') {
  $mj = Get-JavaMajor 'java'
  if ($mj -ge 17) { Write-Result PASS 'JDK' "Java $mj (>= 17)"; $jdkOk = $true }
  elseif ($mj -gt 0) { Write-Result WARN 'JDK' "PATH java is Java $mj (<17); a newer JDK is needed to build" }
  else { Write-Result WARN 'JDK' 'java present but version unparsable' }
}
if (-not $jdkOk) {
  if (Test-Path $asJbrJava) {
    $mj = Get-JavaMajor $asJbrJava
    if ($mj -ge 17) {
      Write-Result PASS 'JDK (JBR)' "Android Studio JBR = Java $mj  ->  set JAVA_HOME=`"$asStudioJbr`""
      $jdkOk = $true
    }
  }
  if (-not $jdkOk) { Write-Result FAIL 'JDK' 'No JDK 17+ on PATH or Android Studio JBR; install JDK 17+ (Temurin/Zulu/Android Studio)' }
}

# --- Android SDK ---
$sdk = $env:ANDROID_HOME; if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if ($sdk -and (Test-Path $sdk)) { Write-Result PASS 'Android SDK' $sdk }
elseif ($sdk) { Write-Result WARN 'Android SDK' "ANDROID_HOME/SDK_ROOT set but missing: $sdk" }
elseif ($detectedSdk) { Write-Result PASS 'Android SDK' "detected $detectedSdk  ->  set ANDROID_HOME to it (env var is unset)" }
else { Write-Result WARN 'Android SDK' 'ANDROID_HOME/ANDROID_SDK_ROOT unset (Bubblewrap can install an SDK on first run)' }

# --- adb (needed to install the debug APK on a device) ---
if (Test-Cmd 'adb') {
  $v = ((& adb version 2>&1) | Select-Object -First 1)
  Write-Result PASS 'adb' $v
}
elseif ($detectedSdk) { Write-Result PASS 'adb' "$detectedSdk\platform-tools\adb.exe (add platform-tools to PATH)" }
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
$twa = $null
if (Test-Path $manifestPath) {
  try {
    $twa = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
    Write-Result PASS 'twa-manifest' ("packageId=$($twa.packageId) host=$($twa.host)")
  }
  catch { Write-Result FAIL 'twa-manifest' "invalid JSON: $($_.Exception.Message)" }
}
else { Write-Result FAIL 'twa-manifest' "missing $manifestPath" }

# --- Repo config sanity (read-only; catches config/README drift before a build) ---
if ($twa) {
  if ($twa.packageId -eq 'com.cardmajlis.app') { Write-Result PASS 'packageId' $twa.packageId }
  else { Write-Result WARN 'packageId' "expected com.cardmajlis.app, got '$($twa.packageId)'" }

  $expectedWm = "https://$($twa.host)/manifest.webmanifest"
  if ($twa.host -and $twa.webManifestUrl -eq $expectedWm) { Write-Result PASS 'webManifestUrl' $twa.webManifestUrl }
  else { Write-Result WARN 'webManifestUrl' "expected $expectedWm, got '$($twa.webManifestUrl)'" }
}

$readmePath = Join-Path $PSScriptRoot 'README.md'
if (Test-Path $readmePath) {
  $readme = Get-Content -Raw -Path $readmePath
  # The correct init uses @bubblewrap/cli; the bare `npx bubblewrap init` is the wrong package.
  if ($readme -match '@bubblewrap/cli') { Write-Result PASS 'README cmd' 'uses @bubblewrap/cli' }
  else { Write-Result WARN 'README cmd' 'missing @bubblewrap/cli reference' }
  if ($readme -match 'npx bubblewrap init') { Write-Result FAIL 'README cmd' 'contains wrong "npx bubblewrap init" (use @bubblewrap/cli)' }
}

# --- Summary ---
Write-Host '-------------------------------------------------------'
if ($fail -eq 0) { Write-Host ("READY - {0} warning(s). Proceed with the README build runbook." -f $warn) -ForegroundColor Green }
else { Write-Host ("NOT READY - {0} failure(s), {1} warning(s). Fix the FAIL lines first." -f $fail, $warn) -ForegroundColor Red }
Write-Host ''

exit ([int]($fail -gt 0))
