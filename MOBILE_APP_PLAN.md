# Mobile App Strategy — Android / iOS Plan (Stage 33.0)

> **STATUS: DESIGNED (33.0); READINESS (33.1); SCAFFOLD (33.2); BUILD RUNBOOK (33.3); iOS DECISION (33.5);
> iOS PWA HARDENING (33.6) DONE; BUILD TRIAGE (33.4) + OWNER-BUILD TRIAGE HARDENING (33.7) — awaiting owner
> logs.** Stages 33.0–33.6 shipped as the **v0.4.2 "mobile app readiness"** patch (docs + the web-only iOS
> install hint; no native app built). Stage 33.7 hardened the owner-run Android build path (a paste-in
> `BUILD_LOG_TEMPLATE.md`, README known-states + troubleshooting tables, `check-env.ps1` config-sanity
> checks, guards) — still **no native build** in-repo; the owner runs it and pastes logs back. Stage 33.9
> added the **production Asset Links + custom-domain runbook** (§9): the ordered owner path to a
> **full-screen** TWA (custom domain → OAuth → PWA verify → signed AAB → **Play App-Signing SHA-256** →
> real `assetlinks.json`), with verification commands — **still no real `assetlinks.json`, no APK/AAB, no
> store submission, and no invented SHA**. Stage 33.10 added a **read-only** `triage-build-log.ps1` that
> classifies a pasted build log (`[environment]` vs `[repo/config]`) — no build, no install. Stages
> 33.8–33.10 shipped as the **v0.4.3 "mobile app build readiness"** patch (docs + owner-side PowerShell
> helpers + guards; no native build).
> This document chooses a path to **Android and iOS apps** for Card Majlis
> and defines a staged rollout. Stage 33.1 fixed the web/PWA readiness gaps **without** a native project.
> Stage 33.2 added the **TWA config scaffold** at [`android-twa/`](android-twa/) (committed Bubblewrap
> `twa-manifest.json` + `.gitignore` + README). Stage 33.3 added the **owner build runbook**: a read-only
> `check-env.ps1`, exact `bubblewrap init` → `gradlew.bat assembleDebug` → `adb install` steps,
> Asset-Links/keytool verification notes, an expanded on-device QA checklist, and repo guard tests
> (`src/pwa.test.ts`). **Stage 33.4** is the owner-run debug build + triage: no build has run yet, so this
> pass **hardened the docs** — corrected `bubblewrap init --manifest` to take the **Web App Manifest URL**
> (not `twa-manifest.json`; verified against the CLI reference), flagged `npx @bubblewrap/cli` vs the wrong
> `npx bubblewrap`, and added a `webManifestUrl` consistency guard. **None** of these generated/committed
> the Gradle project, built an APK/AAB, created a keystore, shipped a real `assetlinks.json`, or submitted
> to the store — the toolchain (JDK 17+, SDK, Bubblewrap) was unavailable and nothing is faked. Next: the
> owner pastes `check-env.ps1` + `bubblewrap`/Gradle logs and we triage real failures. If code and this
> doc disagree, update this doc first.

**Premise:** the web app is already a **high-quality installable PWA** — the wrappers below reuse the
**deployed web app as the single source of truth**, they do not fork it. Related docs:
[`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md), [`MVP_STATUS.md`](MVP_STATUS.md),
[`DEPLOYMENT.md`](DEPLOYMENT.md), [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md),
[`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md).

---

## 0. What the audit found (current mobile-readiness facts)

| Area | Current state (audited) | Implication for a wrapper |
|---|---|---|
| **Manifest** (`public/manifest.webmanifest`) | `name`/`short_name` **Card Majlis**, `start_url:"/"`, `scope:"/"`, `display:"standalone"`, `orientation:"portrait-primary"`, `theme_color`/`background_color` `#0d4f28`, icons **192 / 512 / maskable-512 / svg**. | TWA-ready. **Gap:** `description` names only 4 games (missing Preferans & 51) — copy fix for 33.1. |
| **Service worker** (`public/sw.js`) | Network-first shell cache; **`/api/*` and `/auth/*` are NETWORK-ONLY** (never cached); WebSocket bypasses `fetch`; **controlled updates** (no `skipWaiting` until the user taps Refresh). Prod-only registration (`src/pwa/pwaClient.ts`). | Ideal for a wrapper — OAuth/stats/live traffic are never served stale; updates never reload mid-game. |
| **Auth** (`server/googleOAuth.ts`) | **Google OAuth Authorization-Code + PKCE**, server-side token exchange, **cookie session** (login-only; no client tokens stored). `redirect_uri` from `GOOGLE_REDIRECT_URI` env (same-origin `/auth/callback`). | **Decisive:** Google **blocks OAuth inside embedded WebViews** (`disallowed_useragent`). A **TWA (Chrome engine)** handles it natively; a **plain Capacitor WebView would break Google login** unless routed through a system browser / Custom Tab. |
| **Voice** (`server/voiceIce.ts`) | Opt-in WebRTC mesh; **STUN by default** (Google public), **TURN via `VOICE_ICE_SERVERS`** env; server relays signaling only; TURN credential is client-visible by design. | Needs **microphone permission**. Works natively under Chrome (TWA). Cross-network still needs **TURN** (existing known limit). WebView needs explicit mic-permission wiring. |
| **Invite / deep links** (`src/net/invite.ts` + `StartMenu`) | Invite link = **`<origin>/?room=<CODE>`** (a same-origin query on `/`); the app reads `?room=` on load and joins. | In-scope `https://…/?room=…` URLs open a **TWA** directly (Digital Asset Links + app-links). No custom scheme needed. |
| **Deploy** (`RENDER_DEPLOY.md`) | **Render Web Service, HTTPS/WSS automatic**, `wss://…/ws`; runs on an **`onrender.com` subdomain** (a custom `cardmajlis.app` domain is assumed by the invite tests but **not confirmed provisioned**). CORS via `ALLOWED_ORIGINS`. | TWA needs a domain you control serving `/.well-known/assetlinks.json` — the onrender.com URL works, but a **custom domain is strongly recommended** for a store launch. Same-origin ⇒ no CORS issue for TWA; a Capacitor custom-scheme origin would need CORS allowance. |
| **PWA install/update UX** (`src/pwa/usePwa.ts`) | Chrome `beforeinstallprompt` banner + iOS-standalone detection + a non-blocking "Update available" banner. `data-standalone` on `<html>` for installed-only CSS. | Reuse as-is; the TWA install replaces the browser install prompt. |

---

## 1. Options audit (Scope A)

| # | Option | How it works | Effort | Pros | Cons / risk |
|---|---|---|---|---|---|
| **1** | **PWA install only** (current) | Add-to-home-screen on Android (Chrome) + iOS (Safari). | **Zero** (done). | No store, no build pipeline, always latest; full feature parity (it *is* the web app). | **No Play/App Store listing** → weak discoverability; **iOS install friction** (Share → Add to Home Screen, non-obvious); no store reviews/ratings; no push on iOS. |
| **2** | **Android TWA** (Trusted Web Activity, via Bubblewrap) | A thin Android app that opens the **production PWA** in a Chrome-backed Trusted Web Activity (full-screen, no browser UI). Verified by **Digital Asset Links** (`assetlinks.json`). | **Low.** | **Uses Chrome's engine** → OAuth / cookies / WebRTC / SW behave **identically to the PWA**; tiny wrapper, near-zero ongoing code; Play listing; app-links open invite URLs; auto-benefits from every web deploy. | Needs `assetlinks.json` + package id + **Play App Signing** key; requires a **PWA quality bar** (Lighthouse installability) and HTTPS; Android-only; needs a domain you control. |
| **3** | **Capacitor WebView** (native shell + WKWebView/Android WebView) | A native iOS+Android shell hosting the web app in a system WebView, with native plugins (push, filesystem, etc.). | **Medium–High.** | One codebase for **both platforms**; access to native plugins later (push, share sheet, biometrics); more control over lifecycle. | **Bigger surface:** Google **OAuth is blocked in the default WebView** → must route login through `@capacitor/browser` (Custom Tab / `ASWebAuthenticationSession`) and hand the session cookie back; **cookie/session** handling across the custom-scheme origin (CORS/`ALLOWED_ORIGINS`); **WebRTC mic permissions** per platform; app lifecycle/backgrounding; native builds + signing for **two** stores; more maintenance. |
| **4** | **Expo / React Native (WebView or Expo DOM)** | An RN app that either hosts a `WebView` or (Expo DOM) renders selected web components in RN. | **High (future only).** | Full native UI + native modules + push if the product ever needs a native shell; large ecosystem. | Migrating a full **Vite/DOM** app (reducers, CSS, PWA, WebRTC, SW) to RN is **expensive** and introduces a **new stack + build/store complexity** for no near-term gain. An RN-`WebView` is just Capacitor with more moving parts. **Only** justified by a strong native-module/native-UI/push requirement — not as the first wrapper. |

### Recommendation — **Android-first via TWA (Option 2)**, PWA-only on iOS for now.

The app's **cookie-session Google OAuth** is the deciding factor: it works flawlessly in Chrome and thus
in a **TWA**, but is **actively blocked** in the embedded WebViews that Capacitor/RN use by default.
Option 2 gives a real Play Store presence with **the least code and the least behavioral risk** (it *is*
the PWA, in Chrome). Options 3/4 add a WebView/native stack whose first job would be to **re-solve OAuth,
cookies, and mic permissions** the TWA gets for free.

---

## 2. Recommended strategy + staged rollout (Scope B)

- **Primary MVP:** **Android TWA** wrapping the production PWA. Web/PWA remains the **single source of
  truth**; the TWA carries no app logic.
- **iOS:** **keep the PWA** (add-to-home-screen) initially. A native iOS app is a **later, separate
  decision** (33.4) — it would be **Capacitor + WKWebView** with OAuth via the system browser, and it
  carries **App Store "minimum functionality" (Guideline 4.2) risk** for a thin wrapper, so it must add
  genuine native value (push, share sheet, offline polish) to pass review.
- **No fork:** both wrappers point at the same deployed URL; there is no separate mobile build of the app.

### Rollout

| Stage | Deliverable | Boundary |
|---|---|---|
| **33.1 — Android TWA readiness** | Verify/finish PWA installability: manifest `name`/`short_name`/`description` (add Preferans+51), **maskable** icon, `theme`/`background` colors, `start_url`/`scope`/`display`; document the **`assetlinks.json`** contents + hosting path (`/.well-known/assetlinks.json`), the **package id** (`com.cardmajlis.app`), **Play App Signing** notes, and the **production-URL/HTTPS** requirement. **No native project.** | design/docs + tiny manifest copy fix only |
| **33.2 — Android TWA scaffold** ✅ | **DONE.** TWA config scaffold at [`android-twa/`](android-twa/): a committed Bubblewrap `twa-manifest.json` (package `com.cardmajlis.app`, host `king-game-cqgd.onrender.com`, `standalone`/`portrait`, theme `#0d4f28`, 512+maskable icons) + `.gitignore` (keystores/APK/AAB/generated Gradle) + README. **Not** done (toolchain absent — JDK 8 only, no Android SDK/Bubblewrap): generating the Gradle project, APK/AAB, keystore, real `assetlinks.json`, store submission. Generated project intentionally not faked. | native scaffold in a separate dir / repo path; no app logic |
| **33.3 — Android build runbook + debug smoke** ✅ | **Runbook DONE (repo side).** Added `android-twa/check-env.ps1` (read-only JDK/SDK/adb/node/Bubblewrap check) + the exact owner build runbook in the README (`check-env` → `bubblewrap init` → `gradlew.bat assembleDebug` → `adb install`), Asset-Links/keytool verification notes, an expanded on-device QA checklist, and repo guard tests. Owner-run remainder is the actual build (→ 33.7). | runbook + guards in repo; owner runs the build |
| **33.4 — Android build triage** ✅ | **DONE (docs harden).** Corrected `bubblewrap init --manifest` to take the **Web App Manifest URL** (verified vs the CLI reference), flagged `npx @bubblewrap/cli`, added a `webManifestUrl` guard. Awaiting owner build logs to triage real failures. | docs + one guard; no build run |
| **33.5 — iOS decision / design** ✅ | **DONE (this section §8).** Audit iOS PWA-only vs Capacitor WKWebView vs native rewrite vs defer; **recommend iOS PWA-only now**, defer any App Store wrapper until Android TWA is proven + a custom domain + store assets exist. Compatibility matrix, hardening checklist, store prerequisites. **No native project.** | design/docs only |
| **33.6 — iOS PWA hardening** ✅ | **DONE.** Added a non-intrusive **iOS A2HS hint** (menu-only, iOS-only, not-installed, dismissible, separate key, in-game–suppressed, no fake button) — pure `shouldOfferIosHint`/`detectIos` + `PwaBanners` UI + i18n ×4 + tests. The rest of the meta/safe-area was already shipping (§8d). **No native, no dependency.** | no native, no App Store |
| **33.7 — Android debug / internal test** ✅ | **Owner-run triage tooling** (`BUILD_LOG_TEMPLATE.md`, README known-states + troubleshooting, `check-env.ps1` config-sanity, guards) **plus a verified debug build+run. Debug build BUILT + RUN (Stage 33.12):** `bubblewrap update` → `gradlew.bat assembleDebug` → **BUILD SUCCESSFUL**; installed + launched on a **Pixel_9 emulator**; the app loads the production PWA and opens as a **Custom Tab** (URL bar visible — expected without a verified `assetlinks.json`); menu / 6-game tagline / Tutorials / Play-locally render and are interactive (screenshots kept locally, git-ignored). **Remaining (owner):** a **signed AAB** on the Play internal track + real `assetlinks.json` for full-screen. **No** generated project/APK/AAB/keystore/screenshots committed. | runbook + triage + guards; build verified in repo env |
| **33.13 — Debug build blocker fix** ✅ | **DONE.** The committed `twa-manifest.json` lacked `splashScreenFadeOutDuration`, so **Bubblewrap 1.24+** generated an invalid `build.gradle` (`splashScreenFadeOutDuration: ,`) and `assembleDebug` failed. Added `"splashScreenFadeOutDuration": 300`; verified `update` → `assembleDebug` → **BUILD SUCCESSFUL**. Hardened `.gitignore` (`emulator-*.png`, `manifest-checksum.txt`) + guards. Config-only; no version bump. | one-line manifest fix + guard |
| **33.14 — Debug build evidence** ✅ | **DONE.** Recorded the verified build+run in `android-twa/DEBUG_BUILD_EVIDENCE.md` (toolchain, commands, emulator launch, visual confirmation, known non-bugs). Improved `check-env.ps1` to **detect** an off-`PATH` Android Studio JBR/SDK and print the `JAVA_HOME`/`ANDROID_HOME` to set (read-only). Docs + guard only; no binaries committed. | evidence doc + check-env detection |
| **33.8 — iOS native wrapper decision** | **Only after Android is validated.** Decide Capacitor/WKWebView vs stay PWA-only; if building, require **external-browser OAuth** (`ASWebAuthenticationSession`) + mic permission + a Guideline 4.2 plan. | decision doc; build only if it clears the risk |
| **33.9 — Android production Asset Links + custom domain** ✅ | **DONE (design/docs, §9).** The ordered owner runbook to a **full-screen** TWA: pick a custom domain → Render custom domain + env → Google OAuth redirect/JS origins → verify PWA on the new origin → signed AAB + **Play App-Signing SHA-256** (not upload/debug) → real `assetlinks.json` (repo-safe: local copy of the example, deploy only when the SHA exists) → verify (manifest/assetlinks/`pm get-app-links`). Warns on the wrong-SHA caching trap. **No** real `assetlinks.json`, APK/AAB, store submission, or invented SHA. | design/docs only; owner runs the store/domain steps |
| **33.10 — Build-log triage helper** ✅ | **DONE.** Added `android-twa/triage-build-log.ps1` — a **read-only** classifier that maps a pasted build log to Category / Evidence / Meaning / Owner action, tagged `[environment]` vs `[repo/config]` (JDK<17, SDK/`ANDROID_HOME`, licenses, wrong `npx bubblewrap`, wrong `--manifest` target, Gradle download/network, missing AGP, adb no-device, Custom-Tab-DAL, Asset Links SHA mismatch, OAuth redirect). Installs/downloads/writes nothing; verified on Java-8/npx/adb/clean samples. README + BUILD_LOG_TEMPLATE + guards updated. | read-only helper + docs; no build, no APK/AAB |
| **Future — Capacitor spike / push** | A Capacitor iOS spike if the owner still wants the App Store; Web Push (Android/Chrome) or native push; splash/share-sheet polish. | opt-in, post-MVP |

---

## 3. Feature compatibility matrix (Scope C)

Legend: ✅ works · ⚠️ risky (needs care) · 🔧 needs work · ❌ not supported.

| Feature | PWA install | **Android TWA** | Capacitor WebView | Expo RN-WebView |
|---|:--:|:--:|:--:|:--:|
| Local (pass-and-play) games | ✅ | ✅ | ✅ | ✅ |
| Online rooms / WebSocket (`wss://…/ws`) | ✅ | ✅ | ⚠️ (WS over WebView; ok on modern WKWebView) | ⚠️ |
| **Google login (OAuth cookie session)** | ✅ | ✅ | ❌ default WebView → 🔧 via system-browser/Custom Tab | ❌ → 🔧 same |
| Avatar upload (image → server WebP) | ✅ | ✅ | ⚠️ (file-input/permissions per platform) | ⚠️ |
| Friends / invites / **deep links `/?room=`** | ✅ | ✅ (app-links in scope) | 🔧 (custom scheme / universal links) | 🔧 |
| **Voice chat (WebRTC + microphone)** | ✅ | ✅ (Chrome mic prompt; TURN for strict NAT) | ⚠️ 🔧 (per-platform mic permission wiring) | ⚠️ 🔧 |
| PWA offline / **SW controlled update** | ✅ | ✅ (Chrome runs the SW) | ⚠️ (SW in WebView varies; often bypass with native cache) | ⚠️ |
| Tutorials (client-only scripted) | ✅ | ✅ | ✅ | ✅ |
| Stats / leaderboards (needs Postgres) | ✅ | ✅ | ✅ | ✅ |
| Share room link (Web Share API) | ✅ | ✅ | ✅ (native share) | ✅ |
| Install / update UX | ⚠️ (browser prompt; iOS manual) | ✅ (store install + SW update) | ✅ (store) | ✅ |
| Push notifications (future) | ⚠️ Android web-push; ❌ iOS PWA (limited) | ⚠️ web-push (Android) | ✅ (native, both) | ✅ |

**Read-out:** the TWA column is essentially the PWA column — that is exactly why it's the low-risk MVP.

---

## 4. Security / privacy (Scope D)

- **Session cookies:** the app authenticates with an **HttpOnly server session cookie** (no client-side
  tokens). In a **TWA** the cookie lives in Chrome's jar for the verified origin → seamless and secure.
  A **Capacitor** app would need the login to complete in a **system browser** and the session cookie to
  be shared back to the WebView origin (custom-scheme ↔ https origin) — a real design task, not free.
- **OAuth redirect URI / app links:** keep `GOOGLE_REDIRECT_URI` a **same-origin `https://…/auth/callback`**;
  the TWA's Digital Asset Links let the **app** own in-scope URLs (incl. `/?room=`). **Never** move OAuth
  into an embedded WebView (Google rejects it) — always Chrome/Custom Tab/`ASWebAuthenticationSession`.
- **No native token storage:** do **not** store Google access/refresh tokens on device (the server
  already stores only the stable `sub` + profile basics). Any future native token storage is a separate,
  deliberate design.
- **Voice:** audio stays **peer-to-peer** (WebRTC mesh); the server relays only signaling; **no recording,
  no server-side audio, no audio in the DB**. The **microphone permission** is opt-in and must show a
  clear in-app prompt before the OS prompt.
- **WebView/Custom-Tab permission prompts:** enumerate them for the store review (mic for voice; storage/
  photos for avatar upload). TWA inherits Chrome's prompts.
- **Store privacy disclosure needs** (Play Data safety / App Privacy):
  - **Account data:** email + Google `sub` + display name/avatar (for sign-in, friends, leaderboards).
  - **Microphone / voice:** used **live** for optional voice chat; **not recorded, not stored, not shared**.
  - **Avatars:** user-uploaded image, processed to WebP, stored server-side (same-origin URL).
  - **Analytics:** **none today** — declare "no analytics" if that stays true (verify before submitting).
  - **Ads:** **none** — declare "no ads" if true.
  - **Data deletion:** provide the account-data deletion path/route in the privacy policy.

---

## 5. Store / account prerequisites (Scope E — owner actions)

**Android (TWA, MVP):**
- **Google Play Console** developer account (one-time fee).
- **Package id:** propose **`com.cardmajlis.app`** (matches the assumed `cardmajlis.app` domain; final
  once the domain is decided).
- **Play App Signing:** enroll — Google holds the **app-signing key**; you keep an **upload key**. ⚠️ the
  SHA-256 that goes in **`assetlinks.json`** must be **Google's app-signing certificate** fingerprint
  (from Play Console → App integrity), **not** the local upload key — a common TWA pitfall.
- **Digital Asset Links:** host `/.well-known/assetlinks.json` on the production origin (see §6).
- **Assets:** app icon (512), feature graphic, **screenshots** (phone), splash; **content rating**
  questionnaire; **Data safety** form (§4); **privacy policy URL**; **support email**.

**iOS (only if 33.4 says build):**
- **Apple Developer Program** account (annual fee).
- Bundle id (e.g. `app.cardmajlis`), signing/provisioning, App Privacy nutrition label, screenshots,
  and a plan to clear **Guideline 4.2** (add native value beyond a web wrapper).

---

## 6. Technical readiness checklist (Scope F — 33.1 fixed the ✅[x] items)

- [x] **Manifest + `index.html` `description`** now name **all six** games (King, Durak, Deberc, Tarneeb,
      Preferans & 51) — fixed in 33.1, guard-tested (`src/pwa.test.ts`).
- [x] `name` / `short_name` present (**Card Majlis**).
- [x] Icons **192 / 512** + a **maskable-512** + svg present (`public/icons/…`); confirm the maskable
      safe-zone renders correctly on Android adaptive icons.
- [x] `theme_color` / `background_color` set (`#0d4f28`).
- [x] `start_url:"/"`, `scope:"/"`, `display:"standalone"`, `orientation` set.
- [x] **Service worker** caches the shell (network-first) and is **prod-only**; `/api`+`/auth` bypass it.
- [x] **Offline** fallback to the cached shell on navigation.
- [ ] **HTTPS production URL** — Render gives HTTPS/WSS, but on an **`onrender.com` subdomain**; decide
      whether to provision the **custom `cardmajlis.app` domain** (recommended) before a store launch, and
      point `assetlinks.json` + `GOOGLE_REDIRECT_URI` + `ALLOWED_ORIGINS` at it.
- [x] **`/health/diagnostics`** exists (version / games.count / db / voice.ice / avatarUploads) — use it in
      the mobile smoke.
- [x] **Deep links `/?room=CODE`** parse on load (`roomCodeFromQuery`) → TWA app-links work in scope.
- [x] **`assetlinks.example.json`** template added at `public/.well-known/assetlinks.example.json`
      (package `com.cardmajlis.app`, **placeholder** fingerprint) — guard-tested. The **real**
      `/.well-known/assetlinks.json` is deliberately **NOT** in the repo (added only at store setup with
      the owner's Play App-Signing SHA-256 — see §7a).
- [ ] **`robots`/SEO metadata** — optional; a store listing carries discovery, but confirm `index.html`
      has sane `<title>`/`<meta description>`/OG tags for link previews (invite shares).
- [x] **Bandwidth** — static media is cache-tiered with ETags (already audited); fine for mobile data.
- [ ] **Voice TURN** — STUN-only fails strict/symmetric NAT (common on mobile carriers); a **TURN**
      (`VOICE_ICE_SERVERS`) is needed for reliable cross-network voice on cellular. (Known limit.)
- [ ] **Render free-tier** — cold starts / single instance / ephemeral rooms; a store app implies a
      warmer tier for a good first-launch experience (note, not a blocker).

---

## 6a. Digital Asset Links, domain & OAuth (Stage 33.1)

> For the **step-by-step production runbook** (custom domain → OAuth → PWA verify → signed AAB → Play
> App-Signing SHA-256 → real `assetlinks.json` → verification commands), see **§9**. This subsection is the
> original design-level summary.

### Digital Asset Links (`assetlinks.json`)

- **Template shipped:** `public/.well-known/assetlinks.example.json` — copy it to `assetlinks.json` at
  **store-setup time only**, filling in the real fingerprint. It must be served at
  **`https://<domain>/.well-known/assetlinks.json`** with `content-type: application/json`, HTTP 200,
  no redirect.
- **Package id:** **`com.cardmajlis.app`** (proposed; finalise with the domain).
- ⚠️ **Fingerprint source:** the `sha256_cert_fingerprints` value MUST be the **Google Play App-Signing**
  certificate's SHA-256 (Play Console → *App integrity → App signing*), **NOT** the local upload key.
  Using the upload key is the #1 reason TWA verification (and thus full-screen launch) silently fails.
- **Owner verification commands** (after hosting the real file):
  ```
  curl -s https://<domain>/.well-known/assetlinks.json          # 200 + the JSON, no redirect
  # Google's official checker:
  https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<domain>&relation=delegate_permission/common.handle_all_urls
  ```

### Domain decision (Scope C)

- **Current:** the app runs on a Render subdomain — **`https://king-game-cqgd.onrender.com`** (HTTPS/WSS
  auto). A TWA *can* verify against this subdomain, but it is **not recommended** for a store launch.
- **Recommended:** provision a **custom domain** (e.g. `cardmajlis.com` / `cardmajlis.app`, owner's
  choice) because: (1) **stable branding** for the Play listing; (2) **assetlinks is tied to the exact
  origin** — an onrender.com hostname could change and break verification; (3) **listing trust**; (4)
  decouples from Render's subdomain scheme. **Do not buy/configure the domain in this stage** — it's an
  owner action tracked in §5 / the store checklist.
- When the domain lands, re-point **`assetlinks.json`**, **`GOOGLE_REDIRECT_URI`**, **`ALLOWED_ORIGINS`**
  (and any `VITE_WS_URL`) at it, and add the new origin to Render + the DNS.

### OAuth / TWA readiness (Scope D)

- The Google **redirect stays a web-origin callback** (`https://<domain>/auth/callback` via
  `GOOGLE_REDIRECT_URI`). A **TWA uses Chrome**, so the existing **cookie session + Authorization-Code +
  PKCE** flow works unchanged — no WebView OAuth, ever.
- **No native token storage** in the future Android package — the server already keeps only the stable
  `sub` + profile basics; the device holds only Chrome's HttpOnly session cookie.
- **Owner action when a custom domain is used:** add the production origin's `…/auth/callback` to the
  Google Cloud OAuth client's **Authorized redirect URIs** (and the origin to **Authorized JavaScript
  origins**) — otherwise sign-in 400s. (Documented in `RENDER_DEPLOY.md`.)

### Voice / mic readiness (Scope E)

- WebRTC mic capture triggers **Android's permission prompt via Chrome/TWA** on first voice-join — no code
  change needed; it behaves like the PWA.
- **STUN-only fails strict/symmetric NAT** (common on cellular). Configure a **TURN** relay
  (`VOICE_ICE_SERVERS`) before broad mobile testing — `/health/diagnostics` should read
  `voice.ice: turn_configured`. (Existing known limit; no code change.)

### PWA install/update inside a TWA (Scope F)

- **Audited, no change needed:** `shouldOfferInstall(…)` already returns **false** when `standalone` is
  true (a TWA launches in `display-mode: standalone`), so the **install banner never shows inside the
  installed app**; and `beforeinstallprompt` doesn't fire there anyway. The **"Update available" banner
  still works** (SW update is independent of standalone). Safe-area CSS vars already exist. Guard:
  `src/pwa/pwaClient.test.ts` (`shouldOfferInstall({…, standalone:true}) === false`).

## 6b. Store listing metadata (Scope G — draft, owner fills the specifics)

| Field | Value / draft |
|---|---|
| **App name** | **Card Majlis** |
| **Short description** (≤80 chars) | *"Six classic card games — King, Durak, Deberc, Tarneeb, Preferans & 51."* |
| **Full description** (draft placeholder) | A card lounge for **six** games — King, Durak, Deberc, Tarneeb, Preferans and 51 (Syrian 51). **Play locally** pass-and-play, or **online** with friends in private rooms with optional **voice chat**. Stats, leaderboards, achievements, and a quick **tutorial** for every game. *(Owner to finalise + localise.)* |
| **Privacy policy URL** | **NEEDED** — publish before submission (covers §4 disclosures). |
| **Support email** | **NEEDED** — a contact address for the listing. |
| **Screenshots** | **NEEDED** — phone screenshots (menu, a game table, the tutorial, achievements). None auto-generated this stage. |
| **Content rating** | Complete the questionnaire (card games; no gambling with real money; optional user voice/text chat → likely *Teen*-ish, owner confirms). |
| **Data safety** (Play) | **Account info:** email + Google user id (sign-in, friends, leaderboards). **Avatars:** user image (optional). **Microphone:** **live** voice only — **not recorded, not stored, not shared**. **Game stats.** **No ads.** **No analytics** *(declare only if it stays true — verify)*. Provide a **data-deletion** path. |
| **Accounts** | **Google Play Console** developer account required (Scope E). |

## 6c. TWA scaffold + build runbook (Stage 33.2 scaffold · 33.3 runbook — DONE)

The scaffold lives at [`android-twa/`](android-twa/) and is **config + runbook only** (no native build):

- **`twa-manifest.json`** — the Bubblewrap **input** (source of truth for the wrapper), hand-authored to
  mirror `public/manifest.webmanifest`: `packageId: com.cardmajlis.app`, `host:
  king-game-cqgd.onrender.com`, `startUrl: /`, `display: standalone`, `orientation: portrait`, theme /
  background / nav colors `#0d4f28`, icons `icon-512.png` + maskable `maskable-512.png`, notifications
  off. Edit this file then `bubblewrap update` — never hand-edit generated Gradle files.
- **`check-env.ps1`** — a **read-only** Windows PowerShell checker (33.3): verifies JDK 17+, Android SDK,
  adb, node/npm, Bubblewrap, and `twa-manifest.json` validity; prints `PASS`/`WARN`/`FAIL`, exits `1` on a
  hard gap. Installs/downloads/writes nothing. (In this repo's env it reports JDK `FAIL` — Java 8.)
- **`.gitignore`** — excludes the generated Android project (`app/`, `gradlew`, `*.gradle`, `.gradle/`),
  build outputs (`*.apk`, `*.aab`, `build/`), and **all keystores** (`*.keystore`, `*.jks`, …). A root
  `.gitignore` safety-net repeats the keystore/APK/AAB/`build/` rules under `android-twa/**`.
- **`README.md`** — the full **owner build runbook** (33.3): prerequisites (JDK 17+, Android SDK, Node,
  `npx @bubblewrap/cli`), `check-env.ps1` → `bubblewrap init` → `.\gradlew.bat assembleDebug` →
  `adb install`, the expected generated-file list + APK path, the **Asset Links / TWA verification**
  explanation (debug key ⇒ Custom Tab URL bar is expected; Play App-Signing SHA-256 → real
  `assetlinks.json`), plus `keytool` debug-SHA and Play Console locations.

**Why config-only:** the environment had **JDK 8 only, no Android SDK, no Bubblewrap** → the Gradle
project cannot be generated or built here. Per the stage rule, generated files are **not faked**; the
owner runs the runbook (33.3) on a machine with the toolchain. `twa-manifest.json` + `check-env.ps1` are
inputs, not generated artifacts, so committing them is honest and stable.

**Owner build path (33.3):** `cd android-twa` → `.\check-env.ps1` (JDK must PASS) →
`bubblewrap init --manifest https://king-game-cqgd.onrender.com/manifest.webmanifest` (set package
`com.cardmajlis.app` at the prompt; optionally `git checkout -- twa-manifest.json` + `bubblewrap update`
to pin the committed config) → `.\gradlew.bat assembleDebug` (or `bubblewrap build`) → output
`app\build\outputs\apk\debug\app-debug.apk` → `adb install -r …`. A **debug** APK is debug-signed, so it
will typically launch as a **Custom Tab (URL bar visible)** — full-screen TWA needs a matching
`assetlinks.json`. The first-run on-device checklist is in [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
("Manual — PWA / mobile → Android TWA first run") and [`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md) §10b.
Repo guards (`src/pwa.test.ts`) fail if a build artifact/keystore is committed or the config drifts from
the manifest.

> **Stage 33.4 correction (build triage).** The `init --manifest` flag takes the **Web App Manifest URL**,
> not this repo's `twa-manifest.json` — verified against the Bubblewrap CLI reference. `init` *writes* a
> `twa-manifest.json` (from the web manifest); `build`/`update` are what *read* it. The runbook above and
> the README were corrected so the owner's first `init` doesn't fail on a wrong argument. No native build
> has been run yet — awaiting the owner's `check-env.ps1` + build logs to triage further.

## 7. Boundaries & non-goals

**Stage 33.0 design / 33.1 readiness:** docs + a manifest/index copy fix + an `assetlinks.example`
template + guard tests. **Stage 33.2 scaffold + 33.3 runbook:** the `android-twa/` config + read-only
`check-env.ps1` + build runbook, plus repo guard tests. **Stage 33.4 build triage:** doc/command fix + a
guard. **Stage 33.5 iOS decision (§8):** design/docs only — recommend **iOS PWA-only** now. **None of
these stages** built or committed a native project/APK/AAB (Android or iOS), created a keystore, added a
runtime dependency, changed DB/server, shipped a real `assetlinks.json`, created an iOS/Capacitor project,
or bumped the version.

**Not chosen (and why):** Capacitor/RN as the *first* wrapper — they'd re-solve OAuth/cookies/mic that a
TWA gets free, for a bigger surface. They stay the **iOS/future** path (§8, decided at **33.8** only after
Android is proven), evaluated on merit.

**Carried invariants:** the **web/PWA is the source of truth**; wrappers never fork app logic; OAuth never
runs in an embedded WebView; voice stays P2P with no recording; no new tracking/ads without an explicit,
disclosed decision.

---

## 8. iOS app decision (Stage 33.5 — design only)

> **Decision: keep iOS PWA-only for now; defer any App Store wrapper until Android TWA is proven.** This
> section is **design-only** — no iOS project, no Capacitor, no dependency, no App Store submission. It
> mirrors the Android §1 audit for iOS specifically. The deciding factor is the same one that made Android
> a TWA: the app's **cookie-session Google OAuth**, which Apple's embedded WebViews handle worse than
> Chrome, plus App Store **Guideline 4.2** "minimum functionality" risk for a thin web wrapper.

### 8a. iOS options audit (Scope A)

| # | Option | How it works | Effort | Pros | Cons / risk |
|---|---|---|---|---|---|
| **1** | **iOS PWA only** *(current + recommended now)* | Safari → **Share → Add to Home Screen**; launches standalone (`navigator.standalone`). No App Store. | **Zero** (already works — `index.html` iOS meta + `pwaClient` detect it). | Least risk; always the latest deploy; full feature parity (it *is* the web app); no review, no fee, no signing. | **Not in the App Store** → weak discoverability; **install friction** (Share→A2HS is non-obvious, Safari-only); **push** is limited (Web Push needs iOS 16.4+ **and** an installed PWA); no store ratings; users trust store installs more. |
| **2** | **Capacitor iOS (WKWebView wrapper)** | A native iOS shell hosting the web app in **WKWebView** + native plugins; shipped via the App Store. | **Medium–High.** | Real App Store listing; native share sheet / push / biometrics later; more lifecycle control. | **Google OAuth is blocked/*problematic* in an embedded WebView** → must route login through **`ASWebAuthenticationSession`** / `@capacitor/browser` and hand the **session cookie** back to the WKWebView origin (custom-scheme ↔ https) — a real design task; **WebRTC mic permission** wiring per-platform (`NSMicrophoneUsageDescription`); **App Store Guideline 4.2** "thin wrapper" rejection risk unless it adds genuine native value; **two** signing/provisioning + review pipelines; ongoing maintenance. |
| **3** | **Native / Expo React-Native rewrite** | Re-implement the UI in RN (or Expo DOM) with native modules. | **Very high (future only).** | Full native UI + modules + push if the product ever needs a native shell. | Migrating a full **Vite/DOM** app (reducers, CSS, PWA, WebRTC, SW) to RN is **expensive** and adds a **new stack + two stores**; an RN-`WebView` is just Capacitor with more parts. Only justified if native features/UI/push become **core** — **not MVP**. |
| **4** | **iOS deferred until Android TWA proven** *(recommended path/timing)* | Ship/validate the **Android TWA** first; revisit iOS once the wrapper approach and store assets are proven. | **Zero now.** | De-risks: Android validates the wrapper model, the store-disclosure set, and the assets **once**, before paying the higher iOS cost; keeps focus. | iOS users stay on the PWA slightly longer (acceptable — the PWA is fully functional). |

### 8b. Recommendation (Scope B)

- **Now: iOS = PWA-only (Options 1 + 4).** Do **not** build an App Store wrapper yet. Revisit only when
  **all** of these hold:
  1. **Android TWA** debug/internal test **succeeds** (validates the "wrap the PWA" model end-to-end);
  2. a **custom domain** exists (stable origin for Digital Asset Links / Universal Links + branding);
  3. **privacy policy URL + support email + phone screenshots** are ready (both stores need them);
  4. the **owner explicitly accepts** the App Store wrapper cost + Guideline 4.2 review risk.
- **If/when iOS App Store is pursued (33.8):** prefer **Capacitor** **only** with an **external-browser
  OAuth** flow — `ASWebAuthenticationSession` (or `@capacitor/browser` Custom Tab equivalent) — and hand
  the session cookie back to the WKWebView origin. **Never** run Google OAuth in a plain embedded WebView
  (Apple's WKWebView + Google's `disallowed_useragent` = broken/again-blocked login). Add real native
  value (share sheet, push, offline polish) to clear **Guideline 4.2**.
- **Not chosen:** a native/Expo rewrite (Option 3) as the first iOS step — highest cost, re-solves
  everything the PWA already does, justified only by a hard native-feature requirement that does not exist
  today.

### 8c. iOS feature compatibility matrix (Scope C)

Legend: ✅ works · ⚠️ risky (needs care) · 🔧 needs work · ❌ not supported.

| Feature | iOS PWA (now) | Capacitor WKWebView | Native / Expo rewrite |
|---|:--:|:--:|:--:|
| Local (pass-and-play) games | ✅ | ✅ | ✅ (re-implement) |
| Online rooms / WebSocket (`wss://…/ws`) | ✅ | ⚠️ (WS on WKWebView; ok on modern iOS) | ⚠️ |
| **Google login (OAuth cookie session)** | ✅ (Safari engine) | ❌ default WebView → 🔧 via `ASWebAuthenticationSession` | ❌ → 🔧 same |
| **Cookies / session** | ✅ (Safari cookie jar) | ⚠️ 🔧 (share cookie custom-scheme ↔ https origin; CORS/`ALLOWED_ORIGINS`) | 🔧 |
| Avatar upload / camera / files | ✅ (file input; server WebP) | ⚠️ (permission plist + plugin wiring) | ⚠️ |
| **Voice (WebRTC + microphone)** | ✅ (Safari mic prompt; TURN for NAT) | ⚠️ 🔧 (`NSMicrophoneUsageDescription` + WKWebView mic wiring) | ⚠️ 🔧 |
| Friends / invites / **`/?room=` deep links** | ✅ (in-app query) | 🔧 (Universal Links / custom scheme) | 🔧 |
| Tutorials (client-only) | ✅ | ✅ | ✅ |
| Achievements / stats (Postgres) | ✅ | ✅ | ✅ |
| Offline / **SW controlled update** | ✅ (Safari runs the SW) | ⚠️ (SW in WKWebView varies; often native cache) | ⚠️ |
| Push notifications (future) | ⚠️ Web Push **iOS 16.4+ & installed PWA only** | ✅ (APNs, native) | ✅ |
| Install / update UX | ⚠️ (manual Share→A2HS; SW update pill works) | ✅ (store install/update) | ✅ |
| **App Store policy risk** | n/a (no store) | ⚠️ **Guideline 4.2** thin-wrapper review | ⚠️ (less, if genuinely native) |

**Read-out:** the iOS-PWA column is the only one that needs **no** re-solving of OAuth/cookies/mic — which
is exactly why it stays the MVP while Android proves the wrapper model.

### 8d. iOS PWA hardening checklist (Scope D — mostly already done; no native)

Audited against `index.html` + `src/pwa/pwaClient.ts`. **Most items already ship** — this stage
**implements nothing**; it records status and flags only obviously-safe doc/meta touch-ups for **33.6**.

- [x] **`apple-touch-icon`** — `index.html` links `/icons/apple-touch-icon.png` (180×180, guard-tested).
- [x] **Viewport + safe area** — `viewport-fit=cover` set; base CSS uses safe-area insets.
- [x] **Status bar** — `apple-mobile-web-app-status-bar-style: black-translucent` (matches the dark
      emerald theme); `theme-color #0d4f28`.
- [x] **Standalone capable + title** — `apple-mobile-web-app-capable` / `mobile-web-app-capable` = `yes`;
      `apple-mobile-web-app-title = Card Majlis`.
- [x] **Standalone detection** — `pwaClient.isStandaloneDisplay(...)` reads `navigator.standalone` (iOS
      home-screen apps) as well as `display-mode: standalone`; `data-standalone` stamped for CSS.
- [x] **Install card suppressed when installed** — `shouldOfferInstall(...)` is false in standalone; the
      **"Update available"** pill (SW-driven) still works on iOS.
- [x] **Offline** — the app-shell SW serves offline; `/api`+`/auth` are network-only (no stale auth).
- [ ] **Apple startup images (splash)** — **optional/deferred**; iOS shows a blank splash without them.
      Not worth the per-device asset matrix for the MVP; revisit later if desired.
- [x] **A2HS help text (Stage 33.6)** — a non-intrusive iOS-only hint ("Tap Share, then Add to Home
      Screen") now shows on the **menu** only, on iOS, when **not** installed and **not** dismissed
      (separate `IOS_HINT_DISMISS_KEY`), suppressed **in-game** like the install card. No fake install
      button. Pure `shouldOfferIosHint` + `detectIos`/`isIosUserAgent`; UI in `PwaBanners`; i18n ×4.
- [ ] **On-device smoke (owner):** from an **installed** iOS PWA — Google login completes in Safari, an
      online room connects over `wss://…/ws`, the **mic** permission prompts on voice-join, an invite
      `…/?room=CODE` opens and joins, 360/390 + **Arabic RTL** show no overflow. (Tracked in
      [`QA_CHECKLIST.md`](QA_CHECKLIST.md) / [`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md).)

### 8e. iOS store prerequisites — only if 33.8 says build (Scope E — owner actions)

- **Apple Developer Program** account (annual fee); a **bundle id** (e.g. `app.cardmajlis`), signing +
  provisioning profiles.
- **Custom domain** strongly recommended first (Universal Links + branding + stable origin).
- **Privacy policy URL** and **support email** (both stores require them).
- **Screenshots** — iPhone sizes (menu, a game table, a tutorial, achievements). None auto-generated.
- **App review notes** — explain it's a **web-account card-game** app: how a reviewer signs in (Google),
  what the microphone is for (optional **live** voice, not recorded), and that games are pass-and-play or
  online. Pre-empt **Guideline 4.2** by listing the native value added.
- **Content rating** — card games, no real-money gambling, optional user voice/text chat.
- **App Privacy ("nutrition label") disclosure:** **account** email + Google user id (sign-in / friends /
  leaderboards); **avatars** (optional user image); **microphone** — **live** voice only, **not recorded,
  not stored, not shared**; **game stats**; **no ads**; **no analytics** *(declare only if it stays true —
  verify before submitting)*; provide a **data-deletion** path.

### 8f. iOS boundaries (this stage)

Design/docs only. **No** iOS native project, **no** Capacitor install, **no** dependency, **no** App Store
submission, **no** runtime code change (iOS PWA meta already ships), **no** version bump. iOS stays
**PWA-only** until the §8b conditions are met and the owner opts in (33.8).

---

## 9. Android production Asset Links + custom domain (Stage 33.9 — design/docs only)

> **Why:** a debug APK (or any build whose signing cert isn't declared in a served `assetlinks.json`)
> opens as a **Custom Tab with a URL bar**, not a full-screen TWA. Full-screen requires a
> **`/.well-known/assetlinks.json`** on the launch origin whose `sha256_cert_fingerprints` matches the
> APK's signing certificate. This section is the **owner runbook** to get there. **This stage ships no
> real `assetlinks.json`, no APK/AAB, no store submission, and invents no SHA** — the real file is created
> only after the owner reads the **Play App-Signing** SHA-256 from Play Console.

### 9a. Domain decision (do this first)

- **Recommended:** a **custom domain** you control — e.g. **`cardmajlis.app`** (apex) or a dedicated
  **`play.cardmajlis.com`** subdomain. Either works; pick one origin and keep it stable. Asset Links are
  tied to the **exact origin** (scheme + host), so the origin must not churn.
- **Why not the `onrender.com` subdomain:** it *can* verify, but (1) the Render hostname can change; (2)
  weaker listing trust/branding; (3) it couples the store identity to Render's scheme. Use it only for a
  throwaway internal test.
- **One origin everywhere:** once chosen, that same origin must serve the **manifest**, the **app**, the
  **`assetlinks.json`**, and be the **OAuth redirect** origin — mixing origins breaks either login or
  verification.

### 9b. Add the custom domain in Render

1. Render dashboard -> the web service -> **Settings -> Custom Domains -> Add Custom Domain** -> enter
   `cardmajlis.app` (and/or `www` / `play.`).
2. Add the DNS records Render shows at your registrar (an `ALIAS`/`ANAME`/`CNAME` for a subdomain, or the
   `A`/`ALIAS` records for an apex). Wait for Render to issue the **TLS cert** (HTTPS/WSS auto).
3. Re-point the app's env to the new origin (Render -> Environment):
   - `GOOGLE_REDIRECT_URI = https://<domain>/auth/callback`
   - `ALLOWED_ORIGINS` includes `https://<domain>` (comma-separated with any others)
   - optional `VITE_WS_URL` if you pin the WebSocket origin

   Redeploy so the client is built against the new origin.

### 9c. Google OAuth for the new origin (or login 400s)

In **Google Cloud Console -> APIs & Services -> Credentials -> your OAuth 2.0 Client**:
- **Authorized redirect URIs:** add `https://<domain>/auth/callback`.
- **Authorized JavaScript origins:** add `https://<domain>`.
- Keep the old origin's entries until you've cut over. (A TWA uses Chrome, so the existing cookie-session
  Authorization-Code + PKCE flow works unchanged — **never** move OAuth into an embedded WebView.)

### 9d. Verify the new origin serves the PWA correctly (before Asset Links)

On the new origin, confirm:
- `https://<domain>/manifest.webmanifest` -> 200, `name` = **Card Majlis**, `start_url`/`scope` = `/`,
  `display` = `standalone`, 192 + 512 + maskable icons (names all six games in `description`).
- The **service worker** registers and the app installs/launches standalone (DevTools -> Application).
- `/api` + `/auth` are reachable (network-only; not cached) and Google login completes end-to-end.
- Static/media headers look right (ETag/cache tiers) — see [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md).

Then update `android-twa/twa-manifest.json` `host` + `webManifestUrl` (and the repo guards in
`src/pwa.test.ts`) to the new origin, and re-`bubblewrap init`/`update` so the wrapper points at it.

### 9e. Get the Play App-Signing SHA-256 (the only correct fingerprint)

- Upload a **signed AAB** to a Play track (internal testing is enough) and enroll in **Play App Signing**.
- **Play Console -> your app -> Test and release -> App integrity -> App signing** -> copy the
  **"App signing key certificate" -> SHA-256 certificate fingerprint** (colon-hex, 32 bytes).
- WARNING: **Do NOT use** the **upload key** SHA or the local **debug** key SHA. They will *not* match what
  Google re-signs the delivered app with, so verification silently fails and the app stays a Custom Tab.
  This is the single most common TWA mistake.

### 9f. Create the real `assetlinks.json` (only after you have the SHA)

Repo-safe workflow — the real file is **not** committed until the SHA exists:

```powershell
# from the repo root, LOCALLY:
Copy-Item public\.well-known\assetlinks.example.json public\.well-known\assetlinks.json
# edit assetlinks.json: replace REPLACE_WITH_GOOGLE_PLAY_APP_SIGNING_SHA256_FINGERPRINT
#   with the Play App-Signing SHA-256 (colon-hex). Keep package_name = com.cardmajlis.app.
```

- Deploy it so it is served at **`https://<domain>/.well-known/assetlinks.json`** with **HTTP 200**,
  **`content-type: application/json`**, and **no redirect**.
- WARNING — caching: a wrong or stale `assetlinks.json` can be **cached by Chrome/Play services** and
  make verification flaky for a while. Get the SHA right the first time; if you must change it, expect a
  delay (reinstall the app / clear the verifier cache) before full-screen kicks in.
- The repo keeps only `assetlinks.example.json`; a guard test fails if a real-looking SHA or a committed
  `assetlinks.json` appears.

### 9g. Verification commands (owner)

Manifest + Asset Links reachability (replace `DOMAIN`):

```powershell
# PowerShell
(Invoke-WebRequest "https://DOMAIN/manifest.webmanifest").StatusCode          # expect 200
(Invoke-WebRequest "https://DOMAIN/.well-known/assetlinks.json").Content       # expect the JSON, 200, no redirect
```
```bash
# Bash
curl -sI  https://DOMAIN/.well-known/assetlinks.json   # 200 + content-type: application/json, no 30x
curl -s   https://DOMAIN/.well-known/assetlinks.json | jq .   # valid JSON
```

JSON sanity — package + fingerprint format:

```bash
# package_name must be com.cardmajlis.app
curl -s https://DOMAIN/.well-known/assetlinks.json | jq -r '.[0].target.package_name'
# fingerprint must be colon-hex (32 bytes -> 95 chars), NOT the placeholder
curl -s https://DOMAIN/.well-known/assetlinks.json | jq -r '.[0].target.sha256_cert_fingerprints[0]' \
  | grep -Eq '^([0-9A-F]{2}:){31}[0-9A-F]{2}$' && echo "fingerprint format OK" || echo "BAD/placeholder fingerprint"
```

Google's official statement checker (open in a browser):

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://DOMAIN&relation=delegate_permission/common.handle_all_urls
```

On-device, once the APK is installed (Android's app-links verifier state):

```bash
adb shell pm get-app-links com.cardmajlis.app
# look for the domain in state "verified". If "1024"/"legacy_failure"/none, DAL isn't verified yet.
# Force a re-check (Android 12+):
adb shell pm verify-app-links --re-verify com.cardmajlis.app
```
> `pm get-app-links` / `pm verify-app-links` need the app installed on a connected device; output format
> varies by Android version — read the per-domain state line rather than a fixed column.

### 9h. Production TWA verification — exact order

1. Provision the **custom domain** in Render (9b) and confirm HTTPS/WSS.
2. Add the new origin to **Google OAuth** redirect URIs + JS origins (9c).
3. Verify the **PWA** on the new origin (manifest / SW / login) (9d); update `twa-manifest.json` `host` +
   `webManifestUrl` + guards.
4. Build a **signed AAB**, upload to a Play **internal** track, enroll in **Play App Signing** (9e).
5. Copy the **Play App-Signing SHA-256**; create + deploy the real **`assetlinks.json`** on the domain (9f).
6. Verify reachability + JSON + fingerprint (9g); run Google's checker.
7. Install the app from the internal track; `adb shell pm get-app-links ...` shows the domain **verified**;
   the app now launches **full-screen** (no URL bar).

> Until step 5-7 complete, any build (debug or internal) correctly opens as a **Custom Tab** — that is
> expected, not a bug.
