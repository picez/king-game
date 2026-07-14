# Visual Direction — King Card Lounge (Stage 12.0)

> **Planning doc only. No code/CSS/runtime change in Stage 12.0.** This defines the
> art direction, the bitmap assets to generate (with prompts), an animation plan,
> and a staged rollout (12.1–12.6). It is the source of truth for the redesign;
> implementation stages must follow it and keep gameplay/server/protocol/DB/stats
> unchanged. Screenshots referenced live under `.shots/` (git-ignored, QA only).
>
> **Related:** the matching **sound** direction lives in
> [`SOUND_DESIGN.md`](SOUND_DESIGN.md) (Stage 15.0, planning-only) — a warm, tactile,
> default-OFF audio layer that mirrors this felt/brass/gold aesthetic.

Six games ship and are all `available`: **King, Durak, Deberc, Tarneeb, Preferans, 51**
— local + server-authoritative online, with stats, chat, and sticker reactions.
(Each of the six ships a procedural PNG emblem under `visual/icons/` — Preferans is a
refined brass **top hat** added Stage 19.9, and **51 (Syrian 51)** is **two fanned
brass/gold cards** (`game-fifty-one.png`, 512×512, ~26 KB, `scripts/gen-visual-assets.mjs`,
matching the golden emblem coins) added Stage 30.7; emoji remains only as `GameIcon`'s
onError fallback.) The
**function is strong; the shell reads flat/cheap**. The palette in `base.css` is
already the right idea (dark-green felt + brass/gold); it just needs real texture,
depth, tactile assets, and motion instead of flat CSS gradients + emoji.

---

## 1. Current visual audit

Palette in use (`src/styles/base.css`, keep as the anchor):
`--felt-lit #1f7a45 / --felt-mid #155f36 / --felt-edge #0c4324 / --felt-deep #082b18`,
`--accent #f5c518` (+ `--accent-light #ffe273`, `--accent-dark #b8870a`, `--gold-grad`),
`--card-red #c8102e`, `--text #eef3ef`, translucent `--panel/--surface/--border`.

Assets today: `public/cards/faces/*` (52 real face images), `public/chat-media/*`
(93 sticker gifs/pngs), `public/icons/*` (4 PWA icons). **No felt texture, no
background art, no card back, no game icons (emoji 👑🃏🎴♠️), no ornamental frames.**

| Area | Weak now | Improve to | Assets / motion needed |
|---|---|---|---|
| **Main menu** | Flat radial-gradient green; big emoji tiles; no focal art; feels like a prototype. | A warm, lamp-lit card-lounge hero behind a clean glass app shell; tiles become tactile brass-edged cards. | `menu-hero` bg (P0), panel edge overlay (P1), sheet open motion. |
| **Host/Join sheets** | Plain translucent card on gradient; generic inputs; segmented tabs OK but bland. | Same glass panels on the felt hero, with a subtle brass top-edge and inset shadow; inputs feel carved. | panel frame overlay (P1), button press motion. |
| **Room browser** | Readable (Stage 11.2–11.4) but grey rows on grey; game shown by emoji. | Rows on faint felt, real **game icons**, brass separators, status pills with a bit more life. | `game-icons` set (P0), row hover motion. |
| **Lobby** | Functional list; room code panel is plain; no sense of a "table filling". | Warmer code plaque (brass), seat rows with avatar rings; partnership hint styled. | seat badges (P1), code plaque frame (P2). |
| **Game table (all 4)** | Felt is a CSS radial gradient → flat, banding on big screens; rim looks painted-on. | Real **seamless felt texture** with a subtle woven weave + vignette + a warm light pool at centre; a carved wood rim. | `felt-texture` (P0), `table-rim`/vignette (P1), deal/play motion. |
| **Card backs / hidden cards** | Opponent hands are just a count + `🂠` emoji or `?` placeholders → cheap, no "deck" feeling. | A premium ornamental **card back** for hidden cards, deck, and fanned opponent hands, matching the classic face art. | `card-back-green`, `card-back-red` (P0). |
| **Deck / trump visual** | Trump shown as a plain suit glyph in the header; no deck stack. | A small deck stack (card-back) + a highlighted trump card/badge; ornamental suit badges. | reuse card-back + `suit-badges` (P2). |
| **Profile / stats panels** | Plain stat cards; leaderboard rows plain; medals are emoji. | Brass-trimmed stat tiles; optional rank medals. | `rank-medals` (P2), tab transition motion. |
| **Chat / sticker controls** | FABs are plain circles; picker grid is fine; floating sticker OK. | Brass-ringed FABs; section headings already added (11.2). Mostly motion polish. | sticker-pop motion; FAB style is CSS. |
| **Mobile 360/390** | No overflow (verified across 11.x), but backgrounds must not steal contrast or bloat. | Backgrounds must keep text AA-contrast and ship small (webp, capped). | UI-safe darkened bg zones; size budget. |
| **RTL** | Layout mirrors for text; the **table seat geometry is intentionally not mirrored** (physical left/right) so play order stays correct. | Keep that. Frames/textures must be symmetric so mirroring is a no-op. | symmetric assets only. |
| **Animation / motion** | Essentially none beyond reaction float + trick review pause → static, "cheap". | Tactile micro-motion: sheet open, button press, deal, play-to-table, trick collect, trump reveal, active-player glow. | see §6; all CSS/RAF, reduced-motion aware. |
| **Cross-game consistency** | Each screen re-implements its own felt gradient + seat plates → slightly inconsistent. | One shared felt/rim/card-back/motion system; games differ only by their icon/accent + a per-game trump/rules nuance. | shared texture + icons; per-game accent tint. |

**Verdict:** the bones and palette are right; the cheapness comes from (a) flat
gradient felt, (b) emoji stand-ins for game icons + card backs, (c) zero motion.
Fix those three and the app jumps a tier without touching gameplay.

---

## 2. Target art direction

Three candidate directions were considered; **Option A is recommended.**

### ✅ Option A — "Levantine Card Lounge" (RECOMMENDED)
Dark-green billiard/card felt, warm **brass & gold** accents, dark **carved walnut**
rim, discreet **Levantine / Syrian geometric** ornament (8-point stars, interlaced
arabesque) used sparingly on card backs, frames, and the menu hero. Soft warm
**lamp-pool** lighting from above-centre. Tactile cards/chips/buttons. Clean modern
glass app shell over it. Premium, warm, readable — not a neon casino, not cartoon.
- **Why:** it matches the existing palette (near-zero re-theming of CSS vars),
  fits Tarneeb's Syrian heritage, and the "one warm table, many games" story unifies
  all five games. Gold-on-green already has strong contrast for AA text.

### Option B — "Midnight Art-Deco"
Charcoal/ink background, teal-green felt inlay, chrome + champagne-gold deco lines,
geometric fan motifs. Sleeker/colder; great for a "poker app" but loses the warm
lounge feel and drifts from the current green.

### Option C — "Warm Wood Parlour"
Heavier wood everywhere, amber lamp light, leather + felt. Cozy but risks looking
busy/heavy on small phones and can crowd text.

**Decision:** ship **A**. It's the lowest-risk upgrade of what's already there and
the most distinctive. B/C ideas (deco fan lines, leather) can be borrowed as small
accents later.

**Signature elements of A**
- Felt: `#155f36` body, `#1f7a45` lit centre, `#0c4324→#082b18` rim shadow (existing vars).
- Brass/gold: `#f5c518` primary, `#ffe273` highlight, `#b8870a` shadow (existing).
- Wood rim: warm walnut `#3a2416 → #5a3a22` with a thin brass bead.
- Ornament: muted brass arabesque at ~8–12% opacity, never competing with cards.
- Light: a soft radial warm pool (slightly warmer than the felt) top-centre; gentle vignette to the rim.

---

## 3. Design principles

1. **Readability first.** Cards, ranks, and the acting turn always win over decoration.
   Body/label text keeps WCAG AA (≥4.5:1) over any background — darken background
   zones behind text rather than lightening text.
2. **Depth, not noise.** Texture + soft shadow + a single light source create depth;
   avoid high-frequency grain, heavy bevels, or drop-shadow soup.
3. **One system, five games.** Shared felt/rim/card-back/motion. A game is identified
   by its icon and a subtle accent tint — never by re-styling the whole table.
4. **Tactile.** Buttons, cards, chips look pressable and respond to touch (≤120ms
   press feedback). Tap targets stay ≥44px.
5. **Mobile-first + RTL-safe.** Design at 360/390 first; assets are symmetric so RTL
   mirroring never breaks them; the table seat geometry stays un-mirrored.
6. **Motion is meaning.** Animate to explain state changes (deal, play, win), not to
   dazzle. Everything honours `prefers-reduced-motion`.
7. **Lightweight.** Backgrounds/textures ship as `webp`, sized to purpose, total new
   art budget target **< 1.5 MB**; individual bg ≤ ~250 KB, texture ≤ ~120 KB,
   card back ≤ ~60 KB, icon ≤ ~20 KB.
8. **Graceful fallback.** Every asset degrades to the current CSS gradient/emoji if it
   fails to load (mirror the existing `CardView` art→text fallback pattern).

---

## 4. Asset list

New art lives under **`public/visual/`** (backgrounds, textures, frames, game icons),
except **card backs** which sit with the faces under **`public/cards/back/`**. All
opaque photographic/texture assets → `webp`; all transparent overlays/icons → `png`
(or `webp` with alpha). Provide `@1x`/`@2x` only where noted.

| # | Asset | Filename (under `public/`) | Dimensions | Format | Alpha | Used in | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Main-menu hero (portrait) | `visual/menu-hero-portrait.webp` | 1242×2208 | webp | opaque | StartMenu bg (mobile) | **P0** |
| 1b | Main-menu hero (wide) | `visual/menu-hero-wide.webp` | 2560×1440 | webp | opaque | StartMenu bg (desktop/tablet) | **P0** |
| 2 | Felt table texture (seamless) | `visual/felt-tile.webp` | 1024×1024 (tileable) | webp | opaque | table bg for all 4 games | **P0** |
| 3 | Card back — classic green/gold | `cards/back/back-green.webp` | 750×1050 | webp | opaque | hidden cards, deck, opp hands | **P0** |
| 3b | Card back — alt red/gold | `cards/back/back-red.webp` | 750×1050 | webp | opaque | alt deck / per-room option | P1 |
| 4 | Game icon set (King/Durak/Deberc/Tarneeb) | `visual/icons/game-{king,durak,deberc,tarneeb}.png` | 512×512 each | png | yes | pickers, room browser, lobby | **P0** |
| 5 | Table rim / vignette overlay | `visual/table-rim.png` | 2560×1440 | png | yes | over felt, all games | P1 |
| 6 | Panel / sheet edge frame (brass) | `visual/panel-frame.png` | 1200×1600 (9-slice-able) | png | yes | sheets, lobby, modals | P1 |
| 7 | Seat badges (crown/bot/offline) | `visual/badges/seat-{host,bot,offline}.png` | 128×128 each | png | yes | lobby + table seat plates | P1 |
| 8 | Winner / finish banner frame | `visual/finish-banner.png` | 1600×640 | png | yes | *Finished screens (all games) | P1 |
| 9 | Suit ornament badges (♠♥♦♣) | `visual/suits/suit-{s,h,d,c}.png` | 256×256 each | png | yes | trump badge, headers | P2 |
| 10 | Rank medals (gold/silver/bronze) | `visual/medals/medal-{1,2,3}.png` | 128×128 each | png | yes | leaderboard | P2 |
| 11 | Ornament tile (arabesque, subtle) | `visual/arabesque-tile.webp` | 512×512 (tileable) | webp | yes | faint panel/menu accent | P2 |

**P0 to generate first:** menu hero (portrait + wide), felt tile, card back green,
game-icon set. These unblock 12.2–12.3 and give the biggest perceived-quality jump.

---

## 5. Image-generation prompts (P0)

General rules baked into every prompt: **no text, no letters, no numbers, no logos,
no watermark, no signature**; premium, tasteful, not cartoon, not neon casino; warm
brass/gold on dark green; soft warm top-centre light; no photoreal humans; no brand
marks; avoid clutter. Generate at the stated resolution (or larger, then downscale)
and export as specified. Iterate 2–3 times and pick the cleanest, most UI-safe result.

### P0-1 — Main menu hero (portrait, 1242×2208, opaque webp)
> A premium mobile card-lounge scene, vertical composition. A dark emerald-green felt
> card table seen at a low warm angle, edged with dark carved walnut wood and a thin
> polished brass rim. A soft warm lamp light pools from the upper-centre and falls off
> into a gentle vignette at the corners. Faint Levantine eight-point-star geometric
> ornament is embossed subtly into the felt, barely visible. A few brass poker chips
> and the corner of an ornate playing-card deck rest tastefully in the lower third.
> Rich, moody, elegant, photographic-illustrative hybrid. IMPORTANT: keep the top 25%
> and the vertical centre darker and uncluttered so white UI text and buttons remain
> readable on top. No text, no letters, no numbers, no logos, no watermark, no people.
> Color palette: emerald green #155f36, brass gold #f5c518, warm walnut brown, deep
> shadow. Aspect ratio 9:16.

### P0-1b — Main menu hero (wide, 2560×1440, opaque webp)
> Same scene and palette as the portrait menu hero, re-composed for a 16:9 landscape
> screen: the felt table fills the frame, warm brass rim along the bottom, the lamp
> light pool centred slightly above middle, darker calmer space on the left third for
> overlaid UI. Elegant, premium, subtle Levantine geometric embossing in the felt.
> No text, no logos, no watermark, no people. Aspect ratio 16:9.

### P0-2 — Felt table texture (1024×1024, SEAMLESS/tileable, opaque webp)
> A seamless, tileable dark-green billiard/card-table felt texture. Fine even woven
> nap, very subtle fibre detail, uniform lighting with NO strong highlights, shadows,
> vignette, or logo so it can repeat invisibly. Deep emerald green around #155f36 with
> gentle tonal variation. Premium and understated, not noisy, not plush carpet. Must
> tile seamlessly on all four edges. No text, no pattern seams, no watermark. Flat,
> top-down, evenly lit. Square 1:1.

### P0-3 — Card back, classic green/gold (750×1050, opaque webp)
> An ornate premium playing-card BACK design, single card, centred and perfectly
> symmetric (mirror-symmetric horizontally and vertically). An intricate brass-gold
> arabesque / Levantine eight-point-star medallion on a deep emerald-green ground, with
> a fine gold filigree border inset a safe margin from the edges, and softly rounded
> corners. Elegant, classic, high-detail line ornament like a luxury casino deck,
> matching a vintage engraved court-card style. Even lighting, no glare. Leave a clear
> safe border (about 6% of each side) with no critical detail. No text, no letters, no
> numbers, no suit symbols, no logo, no watermark. Palette: emerald #155f36 + brass
> #f5c518/#b8870a. Card aspect ratio 2.5:3.5 (portrait).

### P0-3b — Card back, alternate red/gold (750×1050, opaque webp)
> Same ornate, mirror-symmetric playing-card back design and safe border as the classic
> green/gold version, recoloured to a deep crimson-red ground (#8c1120 → #c8102e) with
> the same brass-gold arabesque medallion and filigree border. Matches as a set with
> the green back. No text, no numbers, no suit symbols, no logo, no watermark. Card
> aspect ratio 2.5:3.5 portrait.

### P0-4 — Game icon set (four icons, 512×512 each, transparent png)
> A cohesive set of four premium app game-icons in one consistent style: brass-gold
> emblems with subtle emerald-green enamel accents on a TRANSPARENT background, each a
> single centred emblem with a soft inner bevel, readable when scaled down to 32–48px.
> The four emblems: (1) a regal crown; (2) a playful jester/fool hat with bells; (3) a
> diamond-shaped card-suit gem/token; (4) a spade inside an eight-point Levantine star.
> Same line weight, same lighting, same gold tone across all four so they read as a
> family. Flat-ish icon illustration, not photoreal, gentle depth. No text, no letters,
> no logos, no watermark, no background. Deliver as four separate square transparent
> images. (King = crown, Durak = jester, Deberc = suit gem, Tarneeb = spade-in-star.)

### P1 sample — Winner / finish banner frame (1600×640, transparent png)
> An ornate horizontal ceremonial banner frame with brass-gold laurels and a subtle
> Levantine arabesque flourish at the corners, framing an empty transparent centre for
> UI text. Elegant, celebratory but restrained. Transparent background, symmetric. No
> text, no logos, no watermark. Aspect ratio 5:2.

*(Prompts for the remaining P1/P2 assets follow the same rulebook: transparent,
symmetric, no text/logo, brass-on-green, readable at target size — author them when
those stages begin.)*

---

## 6. Animation plan (design only — no implementation in 12.0)

All motion is CSS transitions/keyframes or small RAF; **no animation library**. Every
item ships a `@media (prefers-reduced-motion: reduce)` fallback that removes movement
(instant state, opacity-only, or none). Mobile: prefer `transform`/`opacity` (GPU),
avoid animating layout/box-shadow on many nodes at once; keep concurrent animated
cards ≤ ~13.

| Animation | Purpose | Duration / easing | Where (later) | Mobile perf | Reduced-motion |
|---|---|---|---|---|---|
| Sheet open/close | Establish the host/join/local sheet as a surface | 180–220ms, cubic-bezier(.2,.8,.2,1) | StartMenu `.sheet` | transform+opacity only | instant show/hide |
| Button press / hover | Tactile feedback | 90–120ms ease-out; scale .97 on press | shared `.btn`/`.tile` | transform only | keep press color, no scale |
| Card deal | Show cards arriving from the deck | 220ms stagger 40ms, ease-out | all game hands on hand-start | transform+opacity; cap stagger | cards appear in place |
| Card play → table | Read who played what | 200ms ease-out translate to trick slot | all game `PLAY_CARD` render | transform only | snap to slot |
| Trick collect | Show who won the trick | 260ms slide toward winner + fade | after trick resolves (reuse review pause) | transform+opacity | brief highlight, no slide |
| Trump reveal | Emphasise the chosen trump | 300ms flip/scale + brass glow pulse (once) | trump set (Durak/Deberc/Tarneeb) | transform+opacity | show final state |
| Bid highlight | Draw eye to the current high bid / declarer | 400ms gentle pulse (1–2x) | Tarneeb bidding, Deberc bid | opacity/box-shadow (single node) | static emphasis |
| Active-player glow | Whose turn it is | continuous 1.6s ease-in-out ring pulse | all seat plates `--acting` | box-shadow on ONE seat only | static ring, no pulse |
| Chat sticker pop | Playful send feedback | 260ms scale-in + settle | RoomSocial media bubble / float | transform+opacity | fade-in |
| Stats tab transition | Smooth panel switch | 160ms crossfade/slide | ProfileMenu tab panels | opacity (+ small translate) | instant swap |
| Menu hero parallax (optional) | Subtle life on the menu | ≤6px on scroll/tilt | StartMenu hero | disabled on low-end / reduce | none |

---

## 7. Implementation stages (after assets exist)

Each stage keeps gameplay/server/protocol/DB/stats unchanged and ends green on
`npm run verify` (typecheck:server + test + build + e2e, run sequentially).

- **12.1 — Asset import pipeline.** Add generated P0 assets under `public/visual/`
  (+ `public/cards/back/`). A tiny `scripts/optimize-visual.mjs` (optional) reports
  sizes; no runtime import. Add source-guard tests that the referenced files exist.
- **12.2 — Card back + felt texture integration.** Add a `CardBack` render path in
  `CardView`/hidden-card rendering (behind a graceful fallback to current emoji/`?`),
  and swap the flat felt gradient for `felt-tile.webp` + vignette via a shared
  `.felt` background layer. All 4 game screens pick it up from shared CSS.
- **12.3 — Main menu / host / join redesign.** Menu hero background + glass panels +
  tactile tiles; sheet open motion; button press. Keep all existing controls/flows.
- **12.4 — Lobby + room browser polish.** Real game icons (replace emoji), brass code
  plaque, seat badges, row hover motion. Filters/sort/auto-refresh (11.3–11.4) intact.
- **12.5 — Table animations.** Deal / play / trick-collect / trump reveal / active
  glow / bid highlight across all five games, all reduced-motion aware.
- **12.6 — Mobile / RTL visual QA + cleanup.** Re-run `scripts/*shots*.mjs` at 360/390,
  verify no overflow, AA contrast over backgrounds, reduced-motion, and asset sizes;
  prune any dead CSS.
- **14.x — Card Majlis app-icon refresh (done).** Replaced the King-era plain gold
  **diamond** PWA/app icons with a multi-game **Card Majlis medallion**: an emerald
  circular felt "coin" (gold rim) + a bold gold **8-point Levantine (Rub el Hizb)
  star** + four subtle gold **suit pips** (♠♥♦♣ = the four suits). No text, no crown;
  reads at 32/64/192/512 px. Procedural, zero-dep — regenerate with `npm run icons`
  (`scripts/generate-icons.mjs`). Emits `icon-192`, `icon-512`, `maskable-512`
  (motif in the safe zone), `apple-touch-icon` (180), `favicon-32`, and a matching
  vector `icon.svg`. Palette = `base.css` felt/brass. No manifest name/theme change.

---

## 8. Acceptance criteria (for the implementation stages)

- No gameplay / server / protocol / DB / stats / auth changes; `RoomSummary` and all
  wire shapes unchanged.
- No horizontal overflow at **360 / 390**; layouts still fit; tap targets ≥44px.
- Text over backgrounds meets **WCAG AA** (≥4.5:1 body, ≥3:1 large).
- `prefers-reduced-motion: reduce` removes/《stills》 every animation.
- Assets optimized: total new art **< 1.5 MB**; per-asset budgets from §3/§7 met;
  everything under `public/` and served by Vite/Render.
- UI remains readable over hero/felt; the current CSS gradient/emoji fallback still
  works if an asset 404s.
- All five games look like one system yet stay distinguishable (icon + accent).
- **RTL** unaffected: table seat/play order not mirrored; frames symmetric.
- `npm run verify` green after each implementation stage.

---

## 9. Out of scope (12.0)

No source/CSS edits, no new dependencies, no self-generated images, no gameplay or
backend work. Card **faces** stay as-is (already good); this pass adds backs,
texture, backgrounds, icons, frames, and motion around them.
