# Card Majlis — production smoke log (paste-in template)

> **Purpose (Stage 34.2).** A fill-in log for the **live** production smoke of a release. The
> public/unauthenticated checks are pre-filled below (they need no login and were run against
> `https://king-game-cqgd.onrender.com`). The rest is **owner-only** — it needs a real Google account,
> a Docker+ffmpeg deploy, a second device, and a microphone, none of which the agent has. Copy this file,
> fill each block with **PASS / FAIL / BLOCKED** + evidence, and hand it back. Classify each FAIL with the
> **Triage rules** at the bottom so a product bug is never confused with a deploy/env/manual issue.

- **New to this? Read** [`OWNER_SMOKE_GUIDE.md`](OWNER_SMOKE_GUIDE.md) **first** — the short 20–30 min
  how-to-test + how-to-report-a-bug page. This template is where you record the results.
- **Full checklist reference:** [`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md) §0–§11.
- Result legend: **PASS** = worked as documented · **FAIL** = reproducible defect (attach repro) ·
  **BLOCKED** = couldn't run (no account/device/mic/network).

---

## 0. Deploy identity

| Field | Value |
|---|---|
| Expected release | `v0.4.4` (tag `v0.4.4`) |
| `diagnostics.version` observed | |
| `diagnostics.commit` observed | |
| Deploy matches tag? | ☐ yes ☐ no (deploy lag — note observed commit) |
| Host | `https://king-game-cqgd.onrender.com` (or custom domain) |

## 1. Public / automated checks (no login) — pre-run baseline

> Run against `https://king-game-cqgd.onrender.com` on **2026-07-21** at commit **f6dceab**. Re-run after
> a redeploy; if any value differs from the "Observed" column, note it and treat per the Triage rules.

| Check | Expected | Observed (baseline) | Re-run |
|---|---|---|---|
| `GET /health/diagnostics` `version` | `0.4.4` | **0.4.4** ✅ | |
| … `commit` | matches deploy | **f6dceab6cdc1** ✅ | |
| … `db` | `enabled` | **enabled** ✅ | |
| … `games.count` / `ids` | `6` incl `fifty-one` | **6** — king,durak,deberc,tarneeb,preferans,fifty-one ✅ | |
| … `voice.ice` | `stun_only` \| `turn_configured` | **stun_only** ⚠️ (no TURN → cross-network voice may fail) | |
| … `avatarUploads` | enabled + ffmpeg + db | **enabled, ffmpeg:true, database:true** ✅ | |
| `HEAD /cards/faces/spades-a.png` | `200 image/png` + `max-age=604800` + ETag | **200, image/png, max-age=604800, ETag** ✅ | |
| `HEAD /cards/faces/AS.png` (wrong) | `404` (not the SPA html) | **404 text/plain** ✅ | |
| `If-None-Match` on real card | `304` | **304** ✅ | |
| `GET /manifest.webmanifest` | name Card Majlis, 6-game desc, 192/512/maskable icons | **all present** ✅ | |
| `GET /.well-known/assetlinks.json` | `404` (no real file until Play SHA) | **404** ✅ (expected) | |

> Note: `/.well-known/assetlinks.example.json` returns **200** (it's a committed placeholder served
> statically) — harmless; TWA verification only ever looks for `assetlinks.json`, which is 404 by design.

**Re-run commands** (owner):
```bash
curl -s  $HOST/health/diagnostics
curl -sI $HOST/cards/faces/spades-a.png          # 200 image/png, max-age=604800, ETag
curl -sI $HOST/cards/faces/AS.png                # 404
```
```powershell
(iwr "$H/cards/faces/spades-a.png" -Method Head -UseBasicParsing).Headers
# 304 comes back as an exception in PowerShell — that is a PASS:
$et = (iwr "$H/cards/faces/spades-a.png" -Method Head -UseBasicParsing).Headers.ETag
try { iwr "$H/cards/faces/spades-a.png" -Headers @{ 'If-None-Match' = $et } -UseBasicParsing } catch { $_.Exception.Response.StatusCode }  # NotModified
```

## 2. Environment (owner run)

| Field | Value |
|---|---|
| Browser + version | |
| Device / OS | |
| Viewport (e.g. 390×844) | |
| Language (test EN + Arabic RTL) | |
| Account pair (A / B for 2-device) | |

## 3. Auth / profile — **owner only**

- [ ] Google **sign-in** completes; `/api/me` returns the profile (not `503`). — PASS / FAIL / BLOCKED
- [ ] Sign-out + sign-in again works; session cookie is HttpOnly. — …

## 4. Avatar — **owner only** (needs Docker+ffmpeg; diagnostics shows ffmpeg:true here)

- [ ] Upload a small image → appears on your seat and the other device's view. — …
- [ ] (native `node` runtime only) upload returns a clean `503` — N/A here (this deploy has ffmpeg). — …

## 5. Friends / invite / join — **owner only**

- [ ] Add by **friend code**; incoming-request badge shows. — …
- [ ] Lobby **Invite friends** → the other device taps **Join** → **actually joins the room**. — …
- [ ] Invite link `…/?room=CODE` opens and joins. — …

## 6. Voice — **owner only** (needs 2 devices + mic; `voice.ice = stun_only` here)

- [ ] Two clients on the **same Wi-Fi** hear each other; mic permission prompts. — …
- [ ] Cross-network pair: **needs TURN** (`VOICE_ICE_SERVERS`) — STUN-only may fall back to text
      (**expected** with the current config). — …

## 7. Six games — minimal smoke each (local + one online)

| Game | Local plays a hand | Online (2 tabs/devices) | Only own hand visible | Result |
|---|---|---|---|---|
| King | ☐ | ☐ | ☐ | |
| Durak | ☐ | ☐ | ☐ | |
| Deberc (Solo 3 / Pairs 4) | ☐ | ☐ | ☐ | |
| Tarneeb **Pairs** | ☐ | ☐ | ☐ | |
| Tarneeb **Solo** | ☐ | ☐ | ☐ | |
| Preferans | ☐ | ☐ | ☐ | |
| 51 (Syrian 51) | ☐ | ☐ | ☐ | |

- [ ] **Tarneeb target score**: host picks **🎯 41/61/101** → lobby line shows `· 🎯 n`; the match ends at
      that total; legacy client (no target) → **41**; rematch keeps it (Pairs **and** Solo). — …

## 8. 51 rule smoke (§5b)

- [ ] **Open once per round**, ≥51 to open; after opening, lay further melds. — …
- [ ] **Discard-to-open**: plain take-discard blocked; only via **"Take & open 51"**. — …
- [ ] **Joker replacement**: opened player swaps the exact card a public joker stands in for. — …
- [ ] **Ace-low layoff**: an `A` lays onto a public `2-3-4` → `A-2-3-4`. — …
- [ ] **Elimination preset** 210/310/410/510 (default 510) shows `☠ n`, survives rematch. — …

## 9. Deberc rule smoke (§5, Stage 30.16)

- [ ] **Trump-exchange restriction**: 🔄 shows only when the exposed card is trump and the 7/6 was
      **dealt to hand** (not from прикуп); online server rejects otherwise. — …
- [ ] **Бела on play**: declared at play time (🔔 + trump K/Q), scores 20 only if that trick is won. — …
- [ ] **Палтіна length-first**: a 5-card Палтіна beats a 4-card one regardless of top card. — …

## 10. Tutorials / achievements / mobile

- [ ] **Tutorials**: 🎓 hub lists all **6**; each Start→Done works; **no** network call. — …
- [ ] **Achievements**: Profile → grid shows **29** badges (`n/29`); a first win flips the game badge. — …
- [ ] **Mobile 360/390 + Arabic RTL**: menu / a game table / profile — no horizontal overflow; RTL mirrors. — …

## 11. Android TWA (optional — no app shipped this release)

- [ ] `android-twa\check-env.ps1` JDK PASS → `npx @bubblewrap/cli@latest init --manifest
      https://king-game-cqgd.onrender.com/manifest.webmanifest` → `.\gradlew.bat assembleDebug` →
      install. Custom Tab URL bar is **expected** until a real `assetlinks.json` (Play SHA) — see §9. — …
- [ ] Classify any failure offline: `.\triage-build-log.ps1 .\<log>`. — …

---

## Triage rules — classify every FAIL before filing

| Bucket | Signature | What to do |
|---|---|---|
| **Product bug** | Reproducible with **exact steps** in the released UI on the current commit; not explained below. | File with repro + screenshot + the game/screen + commit. This is the only bucket that becomes a repo change. |
| **Deploy / env** | `diagnostics.version` ≠ expected (deploy lag); `db` not `enabled`; `avatarUploads.ffmpeg:false` (native node runtime → `503` is expected); `voice.ice: stun_only` failing cross-network (no TURN); Google login `redirect_uri_mismatch` (origin not in OAuth client); Render **cold start**/timeout on first hit. | Fix in Render/Google/DNS config, **not** the repo. Note the observed value. |
| **Manual-only / BLOCKED** | No Google account, no second device, no microphone, no Docker+ffmpeg host. | Mark **BLOCKED**; not a defect. |
| **Browser / cache** | Old UI after a deploy; a stale service worker; assets not updating. | **Hard refresh** (Ctrl/Cmd-Shift-R); if installed PWA, tap the **"Update available"** pill; confirm `diagnostics.commit` matches the deploy. |

> Golden rule: a value already listed under **Deploy/env** or **Manual-only** is **not** a product bug —
> don't open a code change for it. Only a reproducible defect in the released UI is.
