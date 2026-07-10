# public/visual — Levantine Card Lounge assets (Stage 12.1)

Generated bitmap assets for the redesign (art direction: [`VISUAL_DIRECTION.md`](../../VISUAL_DIRECTION.md)).
Served statically by Vite/Render (Vite copies `public/` → `dist/`).

> **Not yet wired into any UI/CSS.** Integration lands in Stage 12.2+ (card back +
> felt), 12.3 (menu), 12.4 (lobby/browser). This stage only imports + guards them.
> The manifest + guard test live at `src/visual/visualAssets.ts` / `.test.ts`.

## How these were made

**v1 = procedural PNG, ZERO dependencies** — `scripts/gen-visual-assets.mjs`
(built-in `zlib` only, supersampled for smooth edges; the same technique the
project already uses for its PWA icons in `scripts/generate-icons.mjs`). Regenerate
with `npm run visuals`. Colours come from `src/styles/base.css` (felt green
`#155f36`, brass `#f5c518`, walnut).

These are intentional, on-brand assets — not throwaway placeholders — but they are
**v1**: a designer or an image model can later replace any of them **at the same
path** using the prompts in `VISUAL_DIRECTION.md §5`. If a replacement is `.webp`,
update `format`/`maxBytes` in `src/visual/visualAssets.ts` (the guard follows it).

## Files (P0)

| File | Size (px) | ~Bytes | Purpose |
|------|-----------|--------|---------|
| `felt-tile.png` | 1024×1024 (seamless) | ~292 KB | table felt background (all 5 games) |
| `menu-hero-portrait.png` | 1242×2208 | ~645 KB | mobile menu background (UI-safe: dark top/centre) |
| `menu-hero-wide.png` | 2560×1440 | ~667 KB | desktop/wide menu background |
| `../cards/back/back-green.png` | 750×1050 | ~212 KB | hidden-card / deck back (green + gold star) |
| `icons/game-king.png` | 512×512 (α) | ~6 KB | King emblem (crown) |
| `icons/game-durak.png` | 512×512 (α) | ~8 KB | Durak emblem (jester hat + bells) |
| `icons/game-deberc.png` | 512×512 (α) | ~53 KB | Deberc emblem (suit gem) |
| `icons/game-tarneeb.png` | 512×512 (α) | ~87 KB | Tarneeb emblem (8-point Levantine star) |

> **Preferans (5th game) ships no PNG emblem** — it is intentionally emoji-only (🎩);
> `GameIcon` falls back to the emoji when `game-preferans.png` 404s. A future stage
> could add a procedural `icons/game-preferans.png` (top hat) to match the set.

## Files (P1 — Stage 12.8)

Same procedural generator + palette. Ornamental finish frame + unified seat-status
"coin" badges (dark felt disc + gold rim + a tinted emblem, readable at 16–24 px).

| File | Size (px) | ~Bytes | Purpose |
|------|-----------|--------|---------|
| `finish-frame.png` | 1600×700 (α) | ~64 KB | brass frame + corner rosettes behind the winner card (all 5 games) |
| `badges/badge-host.png` | 256×256 (α) | ~15 KB | host badge (gold crown) — lobby `.tag--host` |
| `badges/badge-bot.png` | 256×256 (α) | ~15 KB | AI badge (robot) — lobby `.tag--bot` |
| `badges/badge-offline.png` | 256×256 (α) | ~15 KB | offline badge (power/off) — lobby `.tag--off` |
| `badges/badge-active.png` | 256×256 (α) | ~14 KB | active-turn badge (▶) — King `.tseat__turn` (others use the CSS glow) |

## WebP optimization (Stage 12.9)

The big **opaque** assets also ship a **WebP** variant, served in preference via CSS
`image-set()` — the PNG stays as the universal fallback (kept inside `image-set` AND
for browsers that don't support it). Regenerate with `npm run visuals:webp` (uses the
system **ffmpeg**/libwebp — no npm dependency). Heroes/back are high-quality lossy; the
seamless **felt tile is LOSSLESS** so repeat edges never band. Small transparent
badges/icons stay PNG (alpha WebP not worth it at that size).

| Asset | PNG | WebP | Saved |
|------|-----|------|-------|
| `menu-hero-portrait` | 645 KB | ~22 KB | −97% |
| `menu-hero-wide` | 667 KB | ~27 KB | −96% |
| `cards/back/back-green` | 212 KB | ~28 KB | −87% |
| `felt-tile` (lossless) | 292 KB | ~225 KB | −23% |
| **preferred (WebP) total** | **1815 KB** | **~302 KB** | **−83%** |

The manifest (`src/visual/visualAssets.ts`) records each `webp` variant next to its PNG
`src`. Note: `CardView`'s hidden-card `<img>` still loads the PNG back (only the CSS
deck/fan backgrounds use the WebP via `--card-back`).

## Not here yet (pending an image model)

The two heroes above are procedural abstract backgrounds (warm light pool on felt +
vignette + faint arabesque + wood band) — UI-safe and premium enough for now. A
richer photographic-illustrative hero can replace them later via the `§5` prompt at
the same paths. Optional future assets (P1/P2 in §4): alternate red card back,
table-rim overlay, panel frame, seat badges, finish banner, suit/rank medals.
