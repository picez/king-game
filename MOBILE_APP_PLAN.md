# Mobile App Strategy — Android / iOS Plan (Stage 33.0)

> **STATUS: DESIGN ONLY.** This document chooses a path to **Android and iOS apps** for Card Majlis and
> defines a staged rollout. It ships **no native project, no dependency, no build-script change, and no
> store submission** — it is the blueprint the build stages (33.1+) follow. When the build starts, code
> follows this doc; if the two disagree, update this doc first (deliberately).

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
| **33.2 — Android TWA scaffold** | Generate the TWA with **Bubblewrap** (or an equivalent minimal wrapper) pointing at the prod URL; wire `assetlinks.json`; **no store submission**. | native scaffold in a separate dir / repo path; no app logic |
| **33.3 — Android internal test build** | A **signed AAB/APK**; install on a **physical Android** device; run the mobile smoke (login, online room, voice, invite deep-link, install/update). | internal testing track only |
| **33.4 — iOS decision** | Decide **PWA-only vs Capacitor/WKWebView**; if building, spike OAuth-via-system-browser + mic permission + assess Guideline 4.2 review risk. | decision doc; build only if it clears the risk |
| **33.5 — Push / native polish (optional)** | Web Push (Android/Chrome) or native push if Capacitor lands; splash/share-sheet polish. | opt-in, post-MVP |

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

## 6. Technical readiness checklist (Scope F — audit, do NOT implement)

Gaps found in the current repo; each is a 33.1 task, not done here.

- [ ] **Manifest `description`** lists only *King, Durak, Deberc & Tarneeb* — **add Preferans & 51** (copy).
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
- [ ] **`assetlinks.json`** not present yet — author it in 33.1 with the **Play app-signing** SHA-256.
- [ ] **`robots`/SEO metadata** — optional; a store listing carries discovery, but confirm `index.html`
      has sane `<title>`/`<meta description>`/OG tags for link previews (invite shares).
- [x] **Bandwidth** — static media is cache-tiered with ETags (already audited); fine for mobile data.
- [ ] **Voice TURN** — STUN-only fails strict/symmetric NAT (common on mobile carriers); a **TURN**
      (`VOICE_ICE_SERVERS`) is needed for reliable cross-network voice on cellular. (Known limit.)
- [ ] **Render free-tier** — cold starts / single instance / ephemeral rooms; a store app implies a
      warmer tier for a good first-launch experience (note, not a blocker).

---

## 7. Boundaries & non-goals

**This stage (33.0):** design only — this document. **No** native project, **no** dependency, **no**
build-script change, **no** store submission, **no** runtime app code change, **no** version bump.

**Not chosen (and why):** Capacitor/RN as the *first* wrapper — they'd re-solve OAuth/cookies/mic that a
TWA gets free, for a bigger surface. They stay the **iOS/future** path (33.4+), evaluated on merit.

**Carried invariants:** the **web/PWA is the source of truth**; wrappers never fork app logic; OAuth never
runs in an embedded WebView; voice stays P2P with no recording; no new tracking/ads without an explicit,
disclosed decision.
