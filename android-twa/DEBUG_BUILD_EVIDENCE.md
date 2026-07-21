# Card Majlis — Android TWA debug build evidence (Stages 33.12 + 33.13)

A record that the Android TWA **debug build was actually generated, installed, and run in an Android
emulator** — so the runbook in [`README.md`](README.md) is verified, not theoretical. It opened as a
**Custom Tab** (URL bar visible), which is the **expected** state for a debug build with no verified
Digital Asset Links; a full-screen TWA needs a real `assetlinks.json` (see [next steps](#next-owner-step)).

> **No binaries are committed.** The generated Gradle project, `app-debug.apk`, keystore, and the
> emulator screenshots stay **local and git-ignored** (see [`.gitignore`](.gitignore)). This file is text
> only — it records paths and outcomes, not the artifacts.

## Environment that worked

| Component | Value |
|---|---|
| **JDK** | Android Studio **JBR = OpenJDK 21** — `C:\Program Files\Android\Android Studio\jbr` (≥17 ✓) |
| **Android SDK** | `C:\Users\User\AppData\Local\Android\Sdk` (platform-tools/adb, emulator, build-tools 33–36.1, platforms 31/34/36/36.1, system-images, licenses) |
| **AVD** | **`Pixel_9`** (also `Medium_Phone_API_36.1`) |
| **Bubblewrap CLI** | **1.24.1** via `npx @bubblewrap/cli@latest` |
| **Device screen** | 1080 × 2424 |

> ⚠️ These tools were installed via **Android Studio** and were **not on `PATH`** / env vars, so
> `check-env.ps1` reported `NOT READY`. Set `JAVA_HOME` = the JBR, `ANDROID_HOME` = the SDK, and prepend
> `…\platform-tools` + `…\emulator` to `PATH` for the session (33.14 taught `check-env.ps1` to *detect*
> these installs and print the exact vars to set).

## Build command summary

```powershell
# 1. Point the session at the Android Studio toolchain (session-only; not persisted):
$env:JAVA_HOME    = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\User\AppData\Local\Android\Sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"

# 2. Generate the Android project from the committed twa-manifest.json (non-interactive):
cd android-twa
npx @bubblewrap/cli@latest update            # writes app/, gradlew.bat, build.gradle (all git-ignored)

# 3. Build the debug APK:
.\gradlew.bat --no-daemon assembleDebug      # -> BUILD SUCCESSFUL
```

- **Result:** `BUILD SUCCESSFUL`; APK at `android-twa\app\build\outputs\apk\debug\app-debug.apk`
  (~5.7 MB, **git-ignored**).
- **Note (Stage 33.13):** this only builds because `twa-manifest.json` now sets
  `"splashScreenFadeOutDuration": 300`. Without it, Bubblewrap 1.24+ writes `splashScreenFadeOutDuration: ,`
  and Gradle fails with `Unexpected input: ','`.
- **Bubblewrap `update` rewrites `twa-manifest.json`** (bumps `appVersion`, uppercases colors, reorders):
  after running it, `git checkout -- twa-manifest.json` to keep the committed config minimal.

## Emulator launch summary

```powershell
emulator -avd Pixel_9 -no-window -no-snapshot -no-audio -no-boot-anim -gpu swiftshader_indirect
adb wait-for-device; adb shell getprop sys.boot_completed        # -> 1
adb install -r .\app\build\outputs\apk\debug\app-debug.apk        # -> Success
adb shell monkey -p com.cardmajlis.app -c android.intent.category.LAUNCHER 1
# Screenshots (binary-safe): screencap on device, then pull (NOT PowerShell `>`, which corrupts PNGs):
adb shell screencap -p /sdcard/cm.png; adb pull /sdcard/cm.png .\emulator-card-majlis.png
```

- `adb install -r` → **Success** (versionName from the generated project).
- `monkey` launch → **Success**; the TWA delegates to Chrome (`TranslucentCustomTabActivity`), logcat shows
  `capturedLink=https://king-game-cqgd.onrender.com/`. No `FATAL`/`ANR`/chromium errors.
- **Chrome First-Run Experience (FRE)** appeared first on the fresh emulator Chrome — tap **"Stay signed
  out"** (and any "Accept & continue") to reach the app. This is emulator setup, not the app.
- It opened as a **Custom Tab with a URL bar** (`king-game-cqgd.onrender.com`) — **expected** for a debug
  build (debug signing key ≠ any hosted `assetlinks.json`).

## Visual confirmation (screenshots are local + git-ignored)

Captured to `android-twa\emulator-card-majlis.png` and `android-twa\emulator-local-games.png` (both
git-ignored). They show:

- **Card Majlis** menu renders (emerald theme, lion medallion, "Player N / Guest", "Sign in").
- The tagline names **all six games**: *"A card lounge for King, Durak, Deberc, Tarneeb, Preferans & 51."*
- Menu items: **Play locally**, **Tutorials** ("Learn any game in 2 min"), **Host online room**, **Join
  online room**, **Profile & settings**.
- Tapping **Play locally** navigates to the **Local game** setup (game picker = King, "Start local game",
  "Back to menu") — i.e. the app is **interactive**, not a static shell.

## Known non-bugs (do not file)

- **Custom Tab / URL bar in debug** — expected until a real `assetlinks.json` (Play App-Signing SHA-256)
  verifies the origin. See [`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md) §9.
- **Chrome First-Run screen** on a fresh emulator — Chrome onboarding, not the app; tap "Stay signed out".
- **`check-env.ps1` says NOT READY** when the Android Studio JBR/SDK aren't on `PATH` — the tools are
  present; set `JAVA_HOME`/`ANDROID_HOME` (33.14's `check-env.ps1` now detects and prints them).
- **Hardware BACK from an internal screen closes the Custom Tab to the launcher** — the SPA may not push
  history for internal views; the on-screen **"Back to menu"** is the intended navigation.

## Next owner step

To get a **full-screen** (verified) TWA and ship it: provision a **custom domain**, build a **signed AAB**,
enrol in **Play App Signing**, take that certificate's **SHA-256**, and deploy a real
`/.well-known/assetlinks.json` — the ordered runbook is [`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md) §9.
