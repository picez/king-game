// ---------------------------------------------------------------------------
// Solitaire engine contract (S1). Every variant implements it; the UI, the
// replay check (server) and the tests only talk to this interface.
// ---------------------------------------------------------------------------

import type { SCard } from './cards';

export const SOLITAIRE_IDS = ['klondike', 'spider', 'freecell', 'pyramid', 'tripeaks', 'yukon', 'forty-thieves', 'hearts'] as const;
/** The seven true solitaires (Hearts lives in the section but is a trick game vs bots). */
export const PATIENCE_IDS = ['klondike', 'spider', 'freecell', 'pyramid', 'tripeaks', 'yukon', 'forty-thieves'] as const;
export type SolitaireId = typeof SOLITAIRE_IDS[number];

/** A playable variant = one leaderboard. */
export const VARIANT_KEYS = [
  'klondike-1', 'klondike-3', 'spider-1', 'spider-2', 'spider-4', 'freecell',
  'pyramid', 'tripeaks', 'yukon', 'forty-thieves', 'hearts',
] as const;
export type VariantKey = typeof VARIANT_KEYS[number];

export const isVariantKey = (v: unknown): v is VariantKey => typeof v === 'string' && (VARIANT_KEYS as readonly string[]).includes(v);
export const solitaireOf = (k: VariantKey): SolitaireId => (k.startsWith('klondike') ? 'klondike' : k.startsWith('spider') ? 'spider' : k) as SolitaireId;

/** Moves are plain JSON so a game is fully described by `seed + moves`. */
export type PileMove =
  | { t: 'move'; from: string; n: number; to: string }
  | { t: 'stock' };

export type PairMove =
  | { t: 'remove'; ids: number[] }  // Pyramid: one King or two cards summing 13; TriPeaks: one card onto the waste
  | { t: 'stock' };

/** Hearts (S5): pass three cards, or play one. */
export type HeartsMove =
  | { t: 'pass'; ids: number[] }
  | { t: 'play'; id: number };

export type Move = PileMove | PairMove | HeartsMove;

export interface Engine<S = unknown, M extends Move = Move> {
  key: VariantKey;
  deal(seed: number): S;
  /** Every legal move, stock action last. */
  legal(s: S): M[];
  /** The next state, or null when the move is illegal. Never mutates `s`. */
  apply(s: S, m: M): S | null;
  won(s: S): boolean;
  /** The suggested move (never a pointless shuffle), or null when stuck. */
  hint(s: S): M | null;
  /** When true, `finish` can play the rest without a decision. */
  canAutoFinish(s: S): boolean;
  /** One step of the auto-finish (a move to a foundation), or null. */
  finishStep(s: S): M | null;
  /** Cards still in play (0 when won) — for the win screen and stats. */
  cardsLeft(s: S): number;
  /** The game ended without a win (Hearts: someone else has the lowest score). */
  lost?(s: S): boolean;
}

/** Generic helpers over the engines. */
export function isStuck<S, M extends Move>(e: Engine<S, M>, s: S): boolean {
  return !e.won(s) && e.legal(s).length === 0;
}

export function replay<S, M extends Move>(e: Engine<S, M>, seed: number, moves: readonly M[]):
  { ok: true; state: S; won: boolean } | { ok: false; at: number } {
  let s = e.deal(seed);
  for (let i = 0; i < moves.length; i++) {
    const next = e.apply(s, moves[i]);
    if (next === null) return { ok: false, at: i };
    s = next;
  }
  return { ok: true, state: s, won: e.won(s) };
}

export type { SCard };
