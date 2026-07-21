# Android TWA — owner build log (paste-in template)

> **Purpose (Stage 33.8).** The agent's environment can't build the APK (no JDK 17+/Android SDK/
> Bubblewrap), so the actual **debug build runs on the owner's machine**. Copy this file's sections,
> run the commands from [`README.md`](README.md), paste the **real output** into each block, and hand it
> back so repo/config issues (not machine setup) can be triaged. **Do not** commit any generated Gradle
> project, APK/AAB, or keystore — only paste the text logs here (this file itself is fine to commit once
> filled, but scrub any absolute paths / usernames you don't want public).

Fill in each block. Leave a block empty (and say why) if a step didn't run.

---

## 0. Machine facts

- OS / version:
- JDK (`java -version`):
- Android SDK (`ANDROID_HOME` / `ANDROID_SDK_ROOT`):
- Node / npm (`node -v`, `npm -v`):
- Device model + Android version (if installing):

## 1. `.\check-env.ps1` — full output

```text
(paste the complete PASS/WARN/FAIL output here, including the final READY/NOT READY line)
```

## 2. Bubblewrap init — full output

Command run (should be the web-manifest URL, via `@bubblewrap/cli`):

```powershell
npx @bubblewrap/cli@latest init --manifest https://king-game-cqgd.onrender.com/manifest.webmanifest
```

```text
(paste stdout/stderr; include the prompt answers you gave — Application ID, colors, keystore choice)
```

## 3. Gradle debug build — full output

```powershell
.\gradlew.bat assembleDebug
```

```text
(paste the tail: BUILD SUCCESSFUL / BUILD FAILED + any stack trace or "what went wrong")
```

- APK produced? (path): `app\build\outputs\apk\debug\app-debug.apk`  →  ☐ yes ☐ no

## 4. Device install — full output

```powershell
adb devices
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

```text
(paste `adb devices` list + the install result: Success / Failure[...])
```

## 5. First-launch observation (the key TWA question)

How did **Card Majlis** open?

- ☐ **Full-screen, no address bar** → the TWA is **verified** (Digital Asset Links matched the signing cert).
- ☐ **Custom Tab with a URL/address bar visible** → **expected for a debug build** (debug key ≠ the
  `assetlinks.json` cert). Not a bug — see the "Known expected states" table in `README.md`.
- ☐ **A generic WebView / crash / white screen** → paste details below; this may be a real issue.

Notes / screenshots description:

```text
(what you saw — status bar color, whether the emerald theme showed, any error toast)
```

## 6. Feature smoke (only if it installed)

Tick what worked; note anything that failed with the exact message:

- ☐ Opens the production URL (`king-game-cqgd.onrender.com`)
- ☐ Google sign-in completes
- ☐ Online room connects (`wss://…/ws`)
- ☐ Voice mic permission prompt
- ☐ Hand drag on touch
- ☐ Tutorials open
- ☐ 51 game smoke
- ☐ 360/390 — no horizontal overflow

```text
(failures / messages)
```
