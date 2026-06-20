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
