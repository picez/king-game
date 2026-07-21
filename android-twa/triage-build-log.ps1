#requires -Version 5.1
<#
.SYNOPSIS
  Read-only classifier for a pasted Android TWA build log (Stage 33.10).

.DESCRIPTION
  The agent's environment can't build the APK, so the owner runs the build and
  pastes the output. This script reads that log FILE and classifies known
  failures into: Category, the Evidence line, what it Means, and the Owner
  action. It ONLY reads the file and prints to stdout — it installs nothing,
  downloads nothing, starts no process, and writes no files.

  Each finding is tagged [environment] (owner machine setup) or [repo/config]
  (something in this repo) so you know who fixes it.

.PARAMETER Path
  Path to a .txt/.log/.md file containing the raw build output (check-env,
  bubblewrap init, gradlew, adb, and your launch observation).

.EXAMPLE
  .\triage-build-log.ps1 .\owner-build-log.md
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  Write-Host "File not found: $Path" -ForegroundColor Red
  exit 2
}

$text = Get-Content -LiteralPath $Path -Raw
if ([string]::IsNullOrWhiteSpace($text)) {
  Write-Host "Log file is empty: $Path" -ForegroundColor Yellow
  exit 2
}
$lines = Get-Content -LiteralPath $Path

# --- Rule table: Category | Type | Patterns (regex, case-insensitive) | Meaning | Action ---
$rules = @(
  [pscustomobject]@{
    Category = 'JDK < 17'
    Type     = 'environment'
    Patterns = @('Unsupported class file major version', 'Unsupported major\.minor version',
                 'invalid (source|target) release', 'requires (Java|JDK) (11|17)',
                 'has been compiled by a more recent version of the Java', 'java version "1\.8', 'JDK 8')
    Meaning  = 'Bubblewrap / the Android Gradle Plugin need JDK 17+; Java 8/11 is on PATH.'
    Action   = 'Install JDK 17+ (Temurin/Zulu or Android Studio JBR); re-run .\check-env.ps1 until JDK = PASS.'
  },
  [pscustomobject]@{
    Category = 'Android SDK missing / ANDROID_HOME unset'
    Type     = 'environment'
    Patterns = @('SDK location not found', 'ANDROID_HOME', 'ANDROID_SDK_ROOT',
                 'Failed to find target with hash string', 'Android SDK not found', 'sdk\.dir')
    Meaning  = 'Gradle cannot locate the Android SDK.'
    Action   = 'Install the SDK (Android Studio or cmdline-tools) and set ANDROID_HOME; or let bubblewrap init provision one.'
  },
  [pscustomobject]@{
    Category = 'Android licenses not accepted'
    Type     = 'environment'
    Patterns = @('You have not accepted the license agreements', 'licenses have not been accepted',
                 'Please accept the SDK license', 'sdkmanager --licenses')
    Meaning  = 'The Android SDK package licenses are not accepted.'
    Action   = 'Run: sdkmanager --licenses  (accept all), then rebuild.'
  },
  [pscustomobject]@{
    Category = 'Wrong npx package (bubblewrap)'
    Type     = 'repo/config'
    Patterns = @('npx bubblewrap(?!/|-cli|.@bubblewrap)', 'registry\.npmjs\.org/bubblewrap\b',
                 'could not determine executable to run', '404 Not Found.*bubblewrap')
    Meaning  = 'Bare "npx bubblewrap" resolves an unrelated npm package, not the TWA CLI.'
    Action   = 'Use: npx @bubblewrap/cli@latest ...  (or npm i -g @bubblewrap/cli).'
  },
  [pscustomobject]@{
    Category = 'Wrong init --manifest target (fed twa-manifest.json)'
    Type     = 'repo/config'
    Patterns = @('init --manifest[^\r\n]*twa-manifest\.json', 'Unable to (fetch|download) (the )?Web Manifest',
                 'Failed to download Web App Manifest', 'not a valid Web Manifest')
    Meaning  = '"init --manifest" takes the WEB App Manifest URL, not this repo''s twa-manifest.json.'
    Action   = 'Use --manifest https://king-game-cqgd.onrender.com/manifest.webmanifest ; build/update read twa-manifest.json.'
  },
  [pscustomobject]@{
    Category = 'Gradle download / network failure'
    Type     = 'environment'
    Patterns = @('Could not download', 'Could not resolve', 'Could not GET', 'Connection timed out',
                 'Read timed out', 'Network is unreachable', 'gradle-[\d.]+-(all|bin)\.zip',
                 'Could not install Gradle distribution')
    Meaning  = 'A proxy/network blocked the Gradle or Maven dependency download.'
    Action   = 'Retry on an open network or configure the proxy (HTTP(S)_PROXY / gradle.properties). This is environment, not repo.'
  },
  [pscustomobject]@{
    Category = 'Android Gradle plugin / distribution missing'
    Type     = 'environment'
    Patterns = @("Plugin \[id: 'com\.android", 'Could not find com\.android\.tools\.build:gradle',
                 'Gradle distribution .* failed', 'Minimum supported Gradle version')
    Meaning  = 'The Android Gradle Plugin or a compatible Gradle distribution is unavailable/mismatched.'
    Action   = 'Let bubblewrap manage versions (re-run init/update); ensure the Gradle download succeeded (see above).'
  },
  [pscustomobject]@{
    Category = 'adb: no device / unauthorized'
    Type     = 'environment'
    Patterns = @('no devices/emulators found', 'device unauthorized', 'device .* offline',
                 'error: no devices', 'adb: no devices', 'more than one device')
    Meaning  = 'adb cannot install because no authorized device is connected.'
    Action   = 'Enable Developer options -> USB debugging, reconnect, accept the RSA prompt, then: adb devices.'
  },
  [pscustomobject]@{
    Category = 'Opens as Custom Tab (Digital Asset Links not verified)'
    Type     = 'repo/config'
    Patterns = @('Custom Tab', 'URL bar', 'address bar', 'not verified', 'app.?links.*(not|failed)',
                 'opens (a|in a)? ?browser')
    Meaning  = 'The build ran but launched with browser UI because no served assetlinks.json matches its signing cert. EXPECTED for a debug build.'
    Action   = 'Normal for debug. Full-screen needs a real assetlinks.json with the Play App-Signing SHA-256 (MOBILE_APP_PLAN.md section 9).'
  },
  [pscustomobject]@{
    Category = 'Asset Links SHA mismatch (upload/debug key mistake)'
    Type     = 'repo/config'
    Patterns = @('assetlinks', 'sha256_cert_fingerprints', 'signatures do not match',
                 'fingerprint .* (mismatch|does not match)', 'upload key', 'debug key.*sha')
    Meaning  = 'assetlinks.json fingerprint does not match the delivered app''s signing cert.'
    Action   = 'Use the Play App-Signing SHA-256 (Play Console -> App integrity -> App signing), NOT the upload or debug key.'
  },
  [pscustomobject]@{
    Category = 'Google OAuth redirect mismatch'
    Type     = 'environment'
    Patterns = @('redirect_uri_mismatch', 'Error 400: redirect_uri_mismatch', 'disallowed_useragent',
                 'invalid redirect', 'origin_mismatch')
    Meaning  = 'The launch origin is not registered in the Google OAuth client (or OAuth ran in a WebView).'
    Action   = 'Add https://<origin>/auth/callback to Authorized redirect URIs + the origin to JS origins (MOBILE_APP_PLAN.md 9c). Never OAuth in an embedded WebView.'
  }
)

function Get-Evidence {
  param([string[]]$Patterns)
  foreach ($ln in $lines) {
    foreach ($p in $Patterns) {
      if ([regex]::IsMatch($ln, $p, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        return $ln.Trim()
      }
    }
  }
  return $null
}

Write-Host ''
Write-Host "Android TWA build-log triage (read-only) - $Path" -ForegroundColor Cyan
Write-Host '======================================================================'

$hits = 0
foreach ($rule in $rules) {
  $evidence = Get-Evidence -Patterns $rule.Patterns
  if ($null -ne $evidence) {
    $hits++
    $color = if ($rule.Type -eq 'repo/config') { 'Yellow' } else { 'Magenta' }
    Write-Host ''
    Write-Host ("[{0}] {1}" -f $rule.Type, $rule.Category) -ForegroundColor $color
    Write-Host ("  Evidence : {0}" -f ($evidence.Substring(0, [Math]::Min($evidence.Length, 160))))
    Write-Host ("  Meaning  : {0}" -f $rule.Meaning)
    Write-Host ("  Action   : {0}" -f $rule.Action)
  }
}

Write-Host ''
Write-Host '----------------------------------------------------------------------'
if ($hits -eq 0) {
  Write-Host 'Unknown - no known failure signature matched.' -ForegroundColor Yellow
  Write-Host 'Paste the FULL log plus the "Machine facts" section from BUILD_LOG_TEMPLATE.md' -ForegroundColor Yellow
  Write-Host '(JDK, Android SDK, Node, device) so it can be triaged by hand.'
}
else {
  Write-Host ("{0} known issue(s) classified. [environment] = your machine; [repo/config] = this repo." -f $hits) -ForegroundColor Green
  Write-Host 'Full runbook: android-twa\README.md  +  MOBILE_APP_PLAN.md section 9.'
}
Write-Host ''

# Exit 0 even when issues are found: this is a classifier, not a gate.
exit 0
