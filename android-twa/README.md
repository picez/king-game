# Card Majlis — Android TWA build runbook (Stage 33.2 scaffold · 33.3 runbook · 33.8 triage)

This folder holds the **Trusted Web Activity (TWA)** wrapper config for the Android app.
A TWA is a thin Android shell that opens the **deployed production PWA** in a Chrome-backed,
full-screen activity — it carries **no app logic**. The web/PWA remains the single source of
truth (see [`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md)).

> **Status: config-only scaffold + owner runbook.** The native Gradle/Android project is **not**
> committed and **not** generated in this repo — the build toolchain (JDK 17+, Android SDK,
> Bubblewrap) was **not available** in the environment that created these stages (JDK 8 only, no
> Android SDK; `check-env.ps1` here reports `FAIL` on JDK). The committed artifacts —
> [`twa-manifest.json`](twa-manifest.json) (Bubblewrap **input**) and [`check-env.ps1`](check-env.ps1)
> (read-only checker) — are honest inputs, not generated output; the Gradle project, APK/AAB, and
> keystore are **intentionally not faked**. Run the runbook below on a machine with the toolchain to
> generate, build, and install a **debug** APK. **No Google Play submission is part of this stage.**

---

## What is committed here

| File | Role |
|---|---|
| `twa-manifest.json` | **Bubblewrap config** (source of truth for the wrapper): package id, host, name, colors, icons, orientation. Hand-authored to match `public/manifest.webmanifest`. Edit **this**, then `bubblewrap update`. |
| `check-env.ps1` | **Read-only** toolchain check (JDK 17+, Android SDK, adb, node/npm, Bubblewrap, manifest JSON). **Also detects an Android Studio JBR/SDK that isn't on `PATH`** and prints the `JAVA_HOME`/`ANDROID_HOME` to set (never writes env vars). Prints `PASS`/`WARN`/`FAIL`; exits `1` on any hard failure. |
| `DEBUG_BUILD_EVIDENCE.md` | Record that the debug APK was **actually built + run in an emulator** (Stages 33.12/33.13): the working toolchain, commands, launch summary, visual confirmation, and known non-bugs. Text only — no binaries. |
| `triage-build-log.ps1` | **Read-only** classifier for a pasted build log — maps known failures to Category / Evidence / Meaning / Owner action, tagged `[environment]` vs `[repo/config]`. Installs/downloads/writes nothing (Stage 33.10). |
| `.gitignore` | Keeps the **generated** Android project, build outputs (`*.apk`/`*.aab`/`build/`/`.gradle/`), and **keystores** out of git. |
| `BUILD_LOG_TEMPLATE.md` | Paste-in template for the **owner's** real build logs (`check-env` → `bubblewrap init` → Gradle → `adb`) so repo/config issues can be triaged (Stage 33.8). Text logs only — never commit generated projects/APKs/keystores. |
| `README.md` | This file. |

Everything else (the `app/` module, `gradlew`, `build.gradle`, `android.keystore`, `*.apk`,
`*.aab`) is generated or secret and is git-ignored on purpose. **Do not commit the generated Gradle
project in this stage** unless you have actually generated **and reviewed** it and deliberately
choose to — the default is to leave it uncommitted and regenerate from `twa-manifest.json`.

---

## Config summary (`twa-manifest.json`)

| Field | Value | Notes |
|---|---|---|
| **App name / launcher** | `Card Majlis` | Matches manifest `name`. |
| **Package id** | `com.cardmajlis.app` | Matches `assetlinks.example.json`. Final once the domain is decided. |
| **Host / start URL** | `king-game-cqgd.onrender.com` · `/` | **MVP uses the Render subdomain.** Replace with the custom domain (e.g. `cardmajlis.app`) **before a Play release** — Digital Asset Links are tied to the exact origin. |
| **Display** | `standalone` | Matches manifest. |
| **Orientation** | `portrait` | Card tables are designed for 360/390 portrait; matches manifest `portrait-primary`. |
| **Theme / background** | `#0d4f28` | Status/nav bar match the manifest theme. |
| **Icons** | `/icons/icon-512.png`, maskable `/icons/maskable-512.png` | Fetched from the live origin at build time. |
| **Web manifest** | `…/manifest.webmanifest` | Bubblewrap reads it to fill defaults. |
| **Notifications** | disabled | No push in the MVP (Stage 33.5, optional). |

If you change the domain, package id, colors, or icons, edit `twa-manifest.json` and run
`bubblewrap update` — do not hand-edit generated Gradle files.

---

## Owner runbook — generate + debug build (Windows PowerShell)

### 1. Install prerequisites

- **JDK 17+** (Temurin/Zulu, or the JBR bundled with Android Studio). Bubblewrap and the Android
  Gradle Plugin need 17 — **JDK 8/11 will not build**.
- **Android Studio** (or the standalone **Android SDK** command-line tools + a platform +
  build-tools). Bubblewrap can also install a JDK/SDK for you on first `init`.
- **Node 22 / npm 10** preferred (Node 18+ works).
- **Bubblewrap CLI** — use `npx @bubblewrap/cli@latest …`, or `npm i -g @bubblewrap/cli`.

> ⚠️ Do **not** add `@bubblewrap/cli` to the web app's `package.json` — it is a build-time developer
> tool, not a runtime dependency (and the npm-11 lockfile policy forbids touching deps here).

### 2. Check the environment (read-only)

```powershell
cd C:\ClaudeCode\builder-agent\projects\king-game\android-twa
.\check-env.ps1
```

Proceed only when JDK is `PASS`. `Android SDK` / `adb` / `Bubblewrap` may be `WARN` (Bubblewrap can
provision an SDK on first run; adb is needed only to install on a device).

### 3. Generate the native Android project

> ⚠️ **`bubblewrap init --manifest` takes the WEB App Manifest URL, not this `twa-manifest.json`.**
> `init` *reads* the site's `manifest.webmanifest` and *writes* a fresh `twa-manifest.json` + the Android
> project. Our committed `twa-manifest.json` is the **reference spec** for the values to confirm at the
> prompts (and the file `build`/`update` read afterwards). Use `npx @bubblewrap/cli@latest …` (not
> `npx bubblewrap`, which resolves an unrelated package).

```powershell
# Global install (or prefix each command with `npx @bubblewrap/cli@latest`):
npm i -g @bubblewrap/cli

# Generate the Android project from the LIVE web manifest (the URL in
# twa-manifest.json's "webManifestUrl"). Bubblewrap parses it and prompts for
# the rest; it also OFFERS to create a signing keystore (android.keystore) —
# accept it; it stays LOCAL and git-ignored.
bubblewrap init --manifest https://king-game-cqgd.onrender.com/manifest.webmanifest
```

At the interactive prompts, **match the committed `twa-manifest.json`** — most values come straight from
the web manifest, but confirm/enter these:

| Prompt | Enter |
|---|---|
| Application ID / package | `com.cardmajlis.app` |
| App name / launcher name | `Card Majlis` |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Theme / background / nav colors | `#0d4f28` |
| Signing key | create a new local `android.keystore` (keep it off git) |

**Optional — pin the exact committed config.** `init` writes its own `twa-manifest.json`; to force the
repo's values, overwrite the generated file with the committed one and regenerate the project:

```powershell
git checkout -- twa-manifest.json   # restore the committed config over init's version
bubblewrap update                   # reads ./twa-manifest.json, regenerates the Android project
```

**Expected generated files** (all git-ignored, appear in this folder):

```
android-twa/
  app/                     # the Android module (AndroidManifest.xml, res/, java/)
  gradle/  gradlew  gradlew.bat
  build.gradle  settings.gradle  gradle.properties
  android.keystore         # local signing key — NEVER commit, back it up
  twa-manifest.json        # init/update rewrite this in place (fingerprints/versionCode/shell version)
  store_icon.png           # fetched launcher icon
```

### 4. Build a debug APK (no Play signing needed)

```powershell
.\gradlew.bat assembleDebug
```

**Expected APK path:**

```
android-twa\app\build\outputs\apk\debug\app-debug.apk
```

(`bubblewrap build` instead produces a **signed release** AAB+APK using `android.keystore` — that is
Stage 33.3-release / 33.4, **not** needed for a debug smoke.)

### 5. Install on a physical Android device

```powershell
# Enable USB debugging on the device, connect it, then:
adb devices                     # confirm the device is listed
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

### 6. Open the app, run the smoke, and record the log

Launch **Card Majlis** from the launcher and work through the on-device checklist in
[`../QA_CHECKLIST.md`](../QA_CHECKLIST.md) ("Manual — PWA / mobile → Android TWA first run") and
[`../PRODUCTION_SMOKE.md`](../PRODUCTION_SMOKE.md) §10b. Capture the outputs of steps 2–5 (and how the app
opened — full-screen vs Custom Tab) into [`BUILD_LOG_TEMPLATE.md`](BUILD_LOG_TEMPLATE.md) and hand it back
so any repo/config issue can be triaged (see **Build log + triage** below).

---

## Asset Links & TWA verification (what "full-screen" depends on)

A TWA only launches **full-screen with no browser UI** when the start origin serves a
`/.well-known/assetlinks.json` whose `sha256_cert_fingerprints` matches the certificate the APK is
**signed with**. Otherwise Chrome falls back to a **Custom Tab (with a URL/address bar)** — the app
still works, it just isn't verified.

### Debug builds (local, expected to show browser UI)

- A `assembleDebug` APK is signed with the **Android debug keystore**, whose SHA-256 will **not**
  match the production `assetlinks.json`. So a debug build **will run but likely show the Custom Tab
  URL bar** — that is expected and fine for the smoke.
- To verify a *debug* build full-screen (optional), print the **debug** keystore's SHA-256 and
  temporarily host an `assetlinks.json` with it (debug-only, never ship this):
  ```powershell
  # DEBUG-ONLY fingerprint (the auto-created Android debug keystore):
  keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" `
    -alias androiddebugkey -storepass android -keypass android
  # copy the "SHA256:" line
  ```

### Play release (the real Asset Links)

- The fingerprint that ships in `public/.well-known/assetlinks.json` must be **Google Play App
  Signing**'s certificate SHA-256, found in **Play Console → your app → Test and release → App
  integrity → App signing → "App signing key certificate" → SHA-256**. ⚠️ **Not** your local upload
  key and **not** the debug key — using either is the #1 reason TWA verification silently fails.
- At store-setup time only, create the real file from the template and deploy it:
  ```powershell
  Copy-Item ..\public\.well-known\assetlinks.example.json ..\public\.well-known\assetlinks.json
  # replace REPLACE_WITH_GOOGLE_PLAY_APP_SIGNING_SHA256_FINGERPRINT with the Play SHA-256
  ```
  ```bash
  curl -s https://<domain>/.well-known/assetlinks.json    # 200, application/json, no redirect
  ```

The repo keeps **only** `assetlinks.example.json` (a placeholder). The real
`/.well-known/assetlinks.json` is deliberately **absent** until store setup — a guard test
(`src/pwa.test.ts`) fails if a real one appears or the placeholder starts to look like a real SHA.

> **Full production runbook** — custom domain → Render + OAuth → PWA verify → signed AAB → **Play
> App-Signing SHA-256** → real `assetlinks.json` → verification commands (incl. `adb shell pm
> get-app-links com.cardmajlis.app`): **[`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md) §9** (design-level
> summary in §6a). A wrong/stale `assetlinks.json` can be **cached** and make verification flaky — get the
> Play App-Signing SHA right the first time; the upload/debug key SHA will **not** verify.

---

## Build log + triage (Stage 33.8)

The agent's environment can't run the toolchain, so the **owner runs the build** and pastes the logs.
Copy [`BUILD_LOG_TEMPLATE.md`](BUILD_LOG_TEMPLATE.md), fill each block with the **real output**
(`check-env` → `bubblewrap init` → `gradlew.bat assembleDebug` → `adb`), note whether the app opened
full-screen or as a Custom Tab, and hand it back. Only **repo/config** issues get fixed in-repo;
machine-setup issues (JDK, SDK, licenses, adb, Play Console) are the owner's to resolve — the tables below
tell them apart.

### Triage a pasted build log (offline helper)

Save your raw build output to a file (e.g. the filled `BUILD_LOG_TEMPLATE.md`, or any `.txt`/`.log`) and
run the **read-only** classifier — it installs/downloads nothing and only prints to the console:

```powershell
cd C:\ClaudeCode\builder-agent\projects\king-game\android-twa
.\triage-build-log.ps1 .\owner-build-log.md
```

For each known failure it prints the **Category**, the **Evidence** line from your log, what it **Means**,
and the **Owner action** — tagged **[environment]** (your machine: JDK/SDK/licenses/network/adb) or
**[repo/config]** (this repo: wrong `npx` package, wrong `--manifest` target, Asset Links / OAuth origin).
It recognises: JDK < 17 · Android SDK / `ANDROID_HOME` missing · unaccepted licenses · wrong `npx
bubblewrap` · wrong `init --manifest` target · Gradle download/network failure · missing Android Gradle
plugin/distribution · adb no-device/unauthorized · Custom-Tab-because-DAL-not-verified · Asset Links SHA
mismatch (upload/debug key mistake) · Google OAuth `redirect_uri_mismatch`. Anything else prints
**"Unknown — paste the full log + Machine facts"**. The helper never fixes machine setup for you; it points
you at the runbook (this README + [`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md) §9).

### Known expected launch states

| What you see on first launch | Meaning | Action |
|---|---|---|
| **Full-screen, no address bar** | Digital Asset Links **verified** — the served `assetlinks.json` SHA-256 matches the APK's signing cert. | Done — this is the goal. |
| **Custom Tab with a URL/address bar** | **Expected for a debug build.** The debug keystore's SHA-256 doesn't match any hosted `assetlinks.json` (there's none in the repo yet). | Normal. Full-screen needs a real `assetlinks.json` from **Play App Signing** (see the Asset Links section). |
| App opens a **plain browser**, not the app | App-links not verified for this origin, or `assetlinks.json` served with a redirect / wrong content-type / 404. | Verify the file at `https://<host>/.well-known/assetlinks.json` (200, `application/json`, no redirect). |
| **Play SHA ≠ debug/upload SHA** | Three different certs exist: debug (local), upload (your key), and Play App-Signing (Google's). Only the **Play App-Signing** SHA belongs in the production `assetlinks.json`. | Copy the SHA from Play Console → App integrity → App signing (**not** the upload/debug key). |

### Troubleshooting (owner)

| Symptom | Cause | Fix |
|---|---|---|
| `npx bubblewrap` installs the wrong thing / command not found | Bare `bubblewrap` resolves an **unrelated** npm package. | Use **`npx @bubblewrap/cli@latest …`** or `npm i -g @bubblewrap/cli`. |
| `init` overwrites/ignores your config, or errors on the manifest | `--manifest` was pointed at `twa-manifest.json`. | `--manifest` takes the **Web App Manifest URL** (`https://…/manifest.webmanifest`). `init` *writes* a twa-manifest; `build`/`update` *read* it. |
| Gradle: "Unsupported class file major version" / build fails immediately | **Java 8/11** on PATH (this repo's env had Java 8). | Install **JDK 17+** (Temurin/Zulu or Android Studio JBR); re-run `.\check-env.ps1` until JDK = PASS. |
| Gradle: `build.gradle` line ~44 `Unexpected input: ','` at `splashScreenFadeOutDuration: ,` | An **old** `twa-manifest.json` missing `splashScreenFadeOutDuration`; Bubblewrap 1.24+ emits an empty value → invalid Groovy. | Fixed in-repo (Stage 33.13): `twa-manifest.json` now sets `"splashScreenFadeOutDuration": 300`. If you hand-author a manifest, include this integer (ms). |
| `SDK location not found` / `ANDROID_HOME` errors | Android SDK missing or env var unset. | Install via Android Studio, or let `bubblewrap init` provision one; set `ANDROID_HOME`. |
| Gradle stops on "You have not accepted the license agreements" | SDK licenses not accepted. | `sdkmanager --licenses` (accept all), then rebuild. |
| Gradle hangs / fails downloading dependencies | Network/proxy blocks the Gradle or Maven download. | Retry on an open network / configure the proxy; this is environment, not repo. |
| `adb: no devices/emulators found` | Device not connected or USB debugging off. | Enable **Developer options → USB debugging**, reconnect, `adb devices`. |
| App opens as a browser tab, not full-screen | Digital Asset Links not verified (see the table above). | Expected for debug; for release host the real `assetlinks.json` with the Play SHA. |
| No **microphone** prompt / voice fails | Mic permission not granted, or strict-NAT without TURN. | TWA inherits Chrome's mic prompt on voice-join; cross-network needs a **TURN** relay (`VOICE_ICE_SERVERS`). |
| **Google login** 400 / `redirect_uri_mismatch` | The launch origin isn't in the OAuth client's authorized redirect URIs. | Add `https://<host>/auth/callback` to the Google OAuth client (and the origin to JavaScript origins). See [`../RENDER_DEPLOY.md`](../RENDER_DEPLOY.md). |

## Signing & secrets

- Bubblewrap generates a local **`android.keystore`** — it is **git-ignored** and must **never**
  be committed or shared. Back it up securely (losing it blocks future Play upload-key resets).
- For a Play release, enroll in **Play App Signing** so Google holds the app-signing key and you
  keep only an upload key.
- No keystore, `*.aab`, or `*.apk` is committed by this scaffold (`.gitignore` + a repo guard test).

---

## Boundaries for this stage

- ✅ Committed: `twa-manifest.json`, `check-env.ps1`, `.gitignore`, `README.md`.
- ❌ Not done: generating/committing the Gradle project, building an APK/AAB, creating a keystore,
  a real `assetlinks.json`, any Play submission, any iOS work, any web gameplay change, any version
  bump, any new web dependency.

Next after a green on-device smoke: **Stage 33.3-release** — a signed internal-test AAB and the Play
internal testing track.
