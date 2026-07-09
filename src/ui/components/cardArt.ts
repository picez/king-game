import type { Rank, Suit } from '../../models/types';

/**
 * Maps a (suit, rank) to its production face-artwork URL under
 * public/cards/faces/. Files are named `{suit}-{rank}.png` with rank lower-cased
 * (J/Q/K/A -> j/q/k/a; digits unchanged, e.g. "10").
 *
 * IMPORTANT: the ORIGINAL source sprite-sheets in card-sources/ had spades.png
 * and clubs.png swapped, but the sliced output in public/cards/faces/ is already
 * named by the TRUE suit (spades-*.png = real ♠, clubs-*.png = real ♣). So this
 * mapping keys directly on the in-game suit with no remapping needed here — the
 * swap was resolved once, at slice time (see scripts/slice-card-sources.mjs).
 */

export const ART_SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
export const ART_RANKS: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

/** Filename rank token: J/Q/K/A -> lowercase, digits unchanged. */
export function rankToFileToken(rank: Rank): string {
  return rank.toLowerCase();
}

/** Bare filename, e.g. "spades-a.png". */
export function cardFaceFile(suit: Suit, rank: Rank): string {
  return `${suit}-${rankToFileToken(rank)}.png`;
}

/**
 * Public URL for a card face, or `null` when the card is not a real, standard
 * card (e.g. a hidden "?" placeholder or an out-of-range rank/suit). A null
 * return means "no artwork — render a card back / placeholder instead".
 */
export function cardFaceUrl(suit: Suit | undefined, rank: Rank | undefined): string | null {
  if (!suit || !rank) return null;
  if (!ART_SUITS.includes(suit)) return null;
  if (!ART_RANKS.includes(rank)) return null;
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}cards/faces/${cardFaceFile(suit, rank)}`;
}

/** All 52 expected face filenames (for asset-existence checks/tests). */
export const ALL_FACE_FILES: string[] = ART_SUITS.flatMap((s) =>
  ART_RANKS.map((r) => cardFaceFile(s, r)),
);

/**
 * Selectable card-back styles. A purely VISUAL profile preference — never
 * gameplay, never in room/WS state, never revealed. `'green'` is the classic
 * default; `'red'` is the burgundy/gold alternate (Stage 13.0); `'blue'` (sapphire)
 * and `'dark'` (charcoal/gold) are added in Stage 13.5. The DB/settings layer
 * stores the legacy value `'classic'` for green (see src/net/userSettings.ts), so
 * `normalizeCardBack` maps `'classic'`/unknown → `'green'` for backward compat.
 */
export type CardBackStyle = 'green' | 'red' | 'blue' | 'dark';
export const CARD_BACK_STYLES: readonly CardBackStyle[] = ['green', 'red', 'blue', 'dark'];

/** Any input → a valid CardBackStyle. Known styles pass through; else → green. */
export function normalizeCardBack(v: string | null | undefined): CardBackStyle {
  return (CARD_BACK_STYLES as readonly string[]).includes(v as string)
    ? (v as CardBackStyle)
    : 'green';
}

/**
 * Maps a visual style to the server/DB `card_style` value: green → the legacy
 * `'classic'` (so existing rows are never broken); red/blue/dark are stored as-is.
 */
export function cardBackToSetting(style: CardBackStyle): 'classic' | 'red' | 'blue' | 'dark' {
  return style === 'green' ? 'classic' : style;
}

/**
 * Public URL for the shared card BACK artwork (Stage 12.2; styled in 13.0) — used
 * for hidden cards, deck stacks, and opponent fans. The UI falls back to a CSS
 * card-back if this file fails to load. `style` defaults to the classic green.
 * See public/cards/back/back-{green,red}.png.
 */
export function cardBackUrl(style: CardBackStyle = 'green'): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}cards/back/back-${style}.png`;
}
export const CARD_BACK_URL = cardBackUrl();

/**
 * WebP variant of the card back (Stage 12.9.1; styled in 13.0) — a much smaller,
 * same-image source preferred via a `<picture><source type="image/webp">` in
 * CardView, with the PNG kept as the universal `<img>` fallback. Mirrors the
 * `card-back-{green,red}` manifest `webp` entries.
 */
export function cardBackWebpUrl(style: CardBackStyle = 'green'): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}cards/back/back-${style}.webp`;
}
export const CARD_BACK_WEBP_URL = cardBackWebpUrl();
