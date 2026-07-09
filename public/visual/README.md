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
| `felt-tile.png` | 1024×1024 (seamless) | ~292 KB | table felt background (all 4 games) |
| `menu-hero-portrait.png` | 1242×2208 | ~645 KB | mobile menu background (UI-safe: dark top/centre) |
| `menu-hero-wide.png` | 2560×1440 | ~667 KB | desktop/wide menu background |
| `../cards/back/back-green.png` | 750×1050 | ~212 KB | hidden-card / deck back (green + gold star) |
| `icons/game-king.png` | 512×512 (α) | ~6 KB | King emblem (crown) |
| `icons/game-durak.png` | 512×512 (α) | ~8 KB | Durak emblem (jester hat + bells) |
| `icons/game-deberc.png` | 512×512 (α) | ~53 KB | Deberc emblem (suit gem) |
| `icons/game-tarneeb.png` | 512×512 (α) | ~87 KB | Tarneeb emblem (8-point Levantine star) |

**Total ≈ 1.92 MB** — slightly above the 1.5 MB aspirational target from
`VISUAL_DIRECTION.md §3`; the two full-res hero PNGs dominate (~1.3 MB). Converting
the opaque assets (heroes/felt/back) to **WebP** in a later optimization pass would
cut ~40–55% and bring the total well under 1 MB. Icons are already tiny.

## Not here yet (pending an image model)

The two heroes above are procedural abstract backgrounds (warm light pool on felt +
vignette + faint arabesque + wood band) — UI-safe and premium enough for now. A
richer photographic-illustrative hero can replace them later via the `§5` prompt at
the same paths. Optional future assets (P1/P2 in §4): alternate red card back,
table-rim overlay, panel frame, seat badges, finish banner, suit/rank medals.
