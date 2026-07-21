# Card Majlis — owner smoke guide (start here)

A **20–30 minute** human walkthrough to confirm the live app works and to report anything that doesn't.
This is the friendly "how to test + how to report" page. The **detailed PASS/FAIL/BLOCKED checkboxes** live
in [`PRODUCTION_SMOKE_LOG_TEMPLATE.md`](PRODUCTION_SMOKE_LOG_TEMPLATE.md); the exhaustive technical pass is
[`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md); deep per-game QA is [`QA_CHECKLIST.md`](QA_CHECKLIST.md).

- **App:** https://king-game-cqgd.onrender.com (or your custom domain)
- **Heads-up:** the free Render tier **cold-starts** — the first page/API hit can take ~1 minute. That is
  not a bug.

## What you need

- **2 devices** (or 2 browsers/profiles) and **2 Google accounts** — most of the value is in the *online*
  checks (rooms, invites, voice, "you only see your own hand"), which need a second player.
- A phone at a small width (**360–390px**) for the mobile pass; set the language to **Arabic** once to
  check right-to-left.
- Optional: a headset/mic on both devices for the voice check.

## Order of checks (top to bottom)

1. **Diagnostics + static** *(no login)* — open `…/health/diagnostics`: `version` matches the release,
   `db: enabled`, `games.count: 6`. A card image loads (`…/cards/faces/spades-a.png`). *(Full commands are
   pre-filled in the log template §1 — you can just re-run them.)*
2. **Login + profile** — sign in with Google; your profile loads (no error). Sign out and back in.
3. **Friends + invite** — add the other account by **friend code**; from the lobby **Invite** them and have
   them tap **Join** — they should land in *your* room (not just a prefilled code).
4. **Voice** — both on the **same Wi-Fi**, join voice, allow the mic, confirm you hear each other.
   *(Different networks may need a TURN relay — see "not a product bug" below.)*
5. **The 6 games** — for each of **King, Durak, Deberc, Tarneeb, Preferans, 51**: play a quick **local**
   hand, then a **2-device online** hand and confirm **each player only sees their own cards**.
6. **Special rules** — **51** (open once ≥51, take-&-open the discard, joker replacement, Ace-low layoff,
   elimination-score preset); **Deberc** (trump-swap only when allowed, Бела declared on play, longer
   Палтіна wins); **Tarneeb** (Pairs and Solo, target score 41/61/101).
7. **Tutorials + achievements** — the 🎓 Tutorials hub plays all 6; Profile → Achievements shows **29**
   badges and a first win flips that game's badge.
8. **Mobile / RTL** — on the phone at 360–390px, and once in **Arabic**, check the menu, one game table,
   and the profile have **no sideways scrolling** and mirror correctly.

Tick each item in [`PRODUCTION_SMOKE_LOG_TEMPLATE.md`](PRODUCTION_SMOKE_LOG_TEMPLATE.md) as **PASS / FAIL /
BLOCKED** as you go.

## How to report a bug

For anything marked **FAIL**, capture these — it's the difference between a fix and a back-and-forth:

- **Game** (King / Durak / Deberc / Tarneeb / Preferans / 51) and **Local or Online**.
- **Room code** if online and it's safe to share.
- **Exact steps** to reproduce, in order.
- **Expected** vs **Actual** result.
- **Screenshot or short video** (a clip beats a description).
- **Browser + device** (e.g. Chrome 128 on Pixel 7) and **viewport** if mobile.
- **`diagnostics` `version` + `commit`** at the time (from `…/health/diagnostics`).
- Whether you tried a **hard refresh** (Ctrl/Cmd-Shift-R) and, if installed as an app, tapped the
  **"Update available"** refresh — this rules out a stale cached version.

## What is *not* a product bug

Don't file these as bugs — they're deploy/config/environment, and each has a known cause:

- **Version/commit doesn't match the release yet** — the deploy is still rolling out. Wait for Render to
  finish, then hard-refresh and re-check `…/health/diagnostics`.
- **Cross-network voice fails / falls back to text** — voice needs a **TURN** relay for strict NATs
  (mobile data especially). Same-Wi-Fi should work; cross-network needs `VOICE_ICE_SERVERS` configured.
- **No iOS App Store app** — iOS is **PWA-only** for now (Add to Home Screen); a native iOS app is a later
  decision, not shipped.
- **Android TWA opens with a URL/address bar (Custom Tab)** — expected for a debug build until a real
  `/.well-known/assetlinks.json` (with the **Play App-Signing SHA-256**) is deployed. See
  [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) §9.
- **Google login fails with `redirect_uri_mismatch`** — the login origin isn't registered in the Google
  OAuth client. A config fix (add `…/auth/callback`), not a code bug — see [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md).
- **Avatar upload returns 503** — only on a non-Docker/no-ffmpeg host; that path is expected to 503. On the
  current deploy (`avatarUploads.ffmpeg: true`) it should work.

When in doubt, note it and share it — the [triage table in the log template](PRODUCTION_SMOKE_LOG_TEMPLATE.md#triage-rules--classify-every-fail-before-filing)
sorts a real bug from a config/environment/cache issue.
