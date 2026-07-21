# Card Majlis — Android TWA scaffold (Stage 33.2)

This folder holds the **Trusted Web Activity (TWA)** wrapper config for the Android app.
A TWA is a thin Android shell that opens the **deployed production PWA** in a Chrome-backed,
full-screen activity — it carries **no app logic**. The web/PWA remains the single source of
truth (see [`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md)).

> **Status: config-only scaffold.** The native Gradle/Android project is **not** committed and
> **not** generated in this repo yet — the build toolchain (JDK 17+, Android SDK, Bubblewrap)
> was **not available** in the environment that created this stage (only JDK 8 / no Android SDK).
> The one committed artifact, [`twa-manifest.json`](twa-manifest.json), is the **input** Bubblewrap
> reads to generate the project; the generated Gradle project, APK/AAB, and signing keystore are
> **intentionally not faked**. Run the commands below on a machine with the toolchain to generate,
> build, and (later) sign. **No Google Play submission is part of this stage.**

---

## What is committed here

| File | Role |
|---|---|
| `twa-manifest.json` | **Bubblewrap config** (source of truth for the wrapper): package id, host, name, colors, icons, orientation. Hand-authored to match `public/manifest.webmanifest`. Edit **this**, then `bubblewrap update`. |
| `.gitignore` | Keeps the **generated** Android project, build outputs (`*.apk`/`*.aab`/`build/`/`.gradle/`), and **keystores** out of git. |
| `README.md` | This file. |

Everything else (the `app/` module, `gradlew`, `build.gradle`, `android.keystore`, `*.apk`,
`*.aab`) is generated or secret and is git-ignored on purpose.

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

## Prerequisites (owner machine)

- **JDK 17+** (Bubblewrap and the Android Gradle Plugin need 17; this environment had only JDK 8).
- **Android SDK** (command-line tools + platform + build-tools). Bubblewrap can install a JDK/SDK
  for you on first run, or point it at existing installs.
- **Node 18+** (for `npx @bubblewrap/cli`).

> ⚠️ Toolchain note: do **not** add `@bubblewrap/cli` to the web app's `package.json` — it is a
> build-time developer tool, not a runtime dependency. Use `npx` or a global install.

---

## Generate the Android project

From this folder:

```bash
cd android-twa

# One-time global install (or use `npx @bubblewrap/cli@latest <cmd>`):
npm i -g @bubblewrap/cli

# Generate the native Android project from twa-manifest.json.
# Bubblewrap reuses the existing twa-manifest.json in this dir; it will
# prompt to create a signing keystore (android.keystore) — keep it LOCAL.
bubblewrap init --manifest ./twa-manifest.json

# After any edit to twa-manifest.json:
bubblewrap update
```

This creates the `app/` module, `gradlew`, and Gradle files here — all git-ignored.

---

## Build a debug APK (no signing key needed)

```bash
cd android-twa
bubblewrap build          # produces a signed release AAB + APK using android.keystore
# — or, plain Gradle for a debug APK only:
./gradlew assembleDebug           # macOS/Linux
gradlew.bat assembleDebug         # Windows
# Output: app/build/outputs/apk/debug/app-debug.apk
```

Install on a physical device:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> This stage requires **only** a debug build for smoke testing. A **signed release AAB** and
> Play upload are **Stage 33.3**, not now.

---

## Digital Asset Links (do this at store setup — NOT now)

The TWA launches full-screen only if the origin serves a valid
`/.well-known/assetlinks.json` matching the app's signing certificate.

1. Enroll in **Play App Signing** (Play Console → *App integrity → App signing*).
2. Copy the **App-signing certificate SHA-256** (⚠️ **not** the local upload key — using the
   upload key is the #1 reason TWA verification silently fails).
3. In the web repo, copy the template and fill the fingerprint:
   ```bash
   cp public/.well-known/assetlinks.example.json public/.well-known/assetlinks.json
   # replace REPLACE_WITH_GOOGLE_PLAY_APP_SIGNING_SHA256_FINGERPRINT with the real SHA-256
   ```
4. Deploy, then verify (200, `application/json`, no redirect):
   ```bash
   curl -s https://<domain>/.well-known/assetlinks.json
   ```

The real `assetlinks.json` is deliberately **absent** from the repo until then — only the
`.example.json` template ships. See [`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md) §6a.

---

## Signing & secrets

- Bubblewrap generates a local **`android.keystore`** — it is **git-ignored** and must **never**
  be committed or shared. Back it up securely.
- For a Play release, enroll in **Play App Signing** so Google holds the app-signing key and you
  keep only an upload key.
- No keystore, `*.aab`, or `*.apk` is committed by this scaffold.

---

## Boundaries for this stage

- ✅ Committed: `twa-manifest.json`, `.gitignore`, `README.md`.
- ❌ Not done: generating the Gradle project, building an APK/AAB, creating a keystore, a real
  `assetlinks.json`, any Play submission, any iOS work, any web gameplay change.

Next: **Stage 33.3** — signed internal-test build + on-device mobile smoke (see the Android QA
checklist in [`../QA_CHECKLIST.md`](../QA_CHECKLIST.md) and [`../PRODUCTION_SMOKE.md`](../PRODUCTION_SMOKE.md)).
