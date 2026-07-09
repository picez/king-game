// ---------------------------------------------------------------------------
// Card face theme — pure helpers (Stage 13.5).
//
// A purely VISUAL profile preference for how FACE-UP cards read. It does NOT
// touch the artwork files (public/cards/faces/*.png) or any rank/suit/deck logic
// — it only flips a CSS theme via `<html data-card-faces="...">`. Never gameplay,
// never room/WS state. No React/DOM here so it can be unit-tested and mirrored by
// server validation (src/net/userSettings.ts) without importing UI code.
//
//   'classic' — the current look (artwork with its own baked-in indices).
//   'clean'   — a higher-contrast reading aid: a bold, larger corner index chip is
//               overlaid on the artwork + a crisper card frame (no artwork change).
// ---------------------------------------------------------------------------

export const CARD_FACE_THEMES = ['classic', 'clean'] as const;
export type CardFaceTheme = (typeof CARD_FACE_THEMES)[number];
export const DEFAULT_CARD_FACE_THEME: CardFaceTheme = 'classic';

/** Any input → a valid CardFaceTheme; unknown/legacy → 'classic'. */
export function normalizeCardFaceTheme(v: string | null | undefined): CardFaceTheme {
  return (CARD_FACE_THEMES as readonly string[]).includes(v as string)
    ? (v as CardFaceTheme)
    : DEFAULT_CARD_FACE_THEME;
}
