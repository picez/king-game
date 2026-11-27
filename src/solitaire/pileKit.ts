// ---------------------------------------------------------------------------
// Pile-game kit (S1): the shared machinery of Klondike, Spider, FreeCell, Yukon
// and Forty Thieves. A variant supplies its deal and its rules (what can be
// picked up, where it can go, what the stock does); the kit does move
// enumeration, application, auto-flip, hints and auto-finish.
//
// Pile ids: 's' stock, 'w' waste, 'f0…' foundations, 't0…' tableau, 'c0…' cells.
// ---------------------------------------------------------------------------

import type { SCard } from './cards';
import type { Engine, PileMove, VariantKey } from './engine';

export interface PileState {
  piles: Record<string, SCard[]>;
  /** Stock recycles used (Klondike) / deals done (Spider). */
  passes: number;
}

export interface PileRules {
  key: VariantKey;
  deal(seed: number): PileState;
  /** Can the top `n` cards of `from` be lifted as one unit (ignoring the target)? */
  canPick(s: PileState, from: string, n: number): boolean;
  /** Can `cards` (bottom first) be dropped on `to`? */
  canDrop(s: PileState, cards: SCard[], to: string, from: string): boolean;
  /** Extra cap on a multi-card move to `to` (FreeCell's free-cell rule). */
  maxMove?(s: PileState, to: string): number;
  /** The stock action, or null when it is not available. */
  stock(s: PileState): PileState | null;
  /** Clean-up after every move (Spider removes finished runs). */
  after?(s: PileState): PileState;
  /** Piles a move may start from. */
  sources(s: PileState): string[];
  /** Piles a move may end on. */
  targets(s: PileState): string[];
  won(s: PileState): boolean;
  /** All cards face up and nothing left to deal: the rest can be auto-played. */
  canAutoFinish(s: PileState): boolean;
}

export const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
export const top = (pile: readonly SCard[] | undefined): SCard | undefined => (pile && pile.length ? pile[pile.length - 1] : undefined);
export const isFoundation = (id: string) => id.startsWith('f');
export const isTableau = (id: string) => id.startsWith('t');
export const isCell = (id: string) => id.startsWith('c');

/** Flips the top card of every tableau pile face up. */
export function flipTops(s: PileState): PileState {
  let piles = s.piles;
  for (const [id, pile] of Object.entries(s.piles)) {
    if (!isTableau(id) || pile.length === 0 || pile[pile.length - 1].up) continue;
    if (piles === s.piles) piles = { ...s.piles };
    piles[id] = [...pile.slice(0, -1), { ...pile[pile.length - 1], up: true }];
  }
  return piles === s.piles ? s : { ...s, piles };
}

/** A foundation accepts the next card of its suit (Ace on empty). */
export function foundationAccepts(f: readonly SCard[], c: SCard): boolean {
  const t = top(f);
  return t ? t.suit === c.suit && c.rank === t.rank + 1 : c.rank === 1;
}

export function countCards(s: PileState, prefix: string): number {
  return Object.entries(s.piles).filter(([id]) => id.startsWith(prefix)).reduce((n, [, p]) => n + p.length, 0);
}

export function makePileEngine(r: PileRules): Engine<PileState, PileMove> {
  function applyMove(s: PileState, m: PileMove): PileState | null {
    if (m.t === 'stock') {
      const next = r.stock(s);
      return next ? (r.after ? r.after(next) : next) : null;
    }
    const { from, n, to } = m;
    if (from === to || !Number.isInteger(n) || n < 1) return null;
    const src = s.piles[from];
    const dst = s.piles[to];
    if (!src || !dst || n > src.length) return null;
    if (!r.sources(s).includes(from) || !r.targets(s).includes(to)) return null;
    if (!r.canPick(s, from, n)) return null;
    if (r.maxMove && n > r.maxMove(s, to)) return null;
    const moving = src.slice(src.length - n);
    if (!r.canDrop(s, moving, to, from)) return null;
    let next: PileState = { ...s, piles: { ...s.piles, [from]: src.slice(0, src.length - n), [to]: [...dst, ...moving] } };
    next = flipTops(next);
    return r.after ? r.after(next) : next;
  }

  function finishStep(s: PileState): PileMove | null {
    for (const m of legal(s)) if (m.t === 'move' && isFoundation(m.to) && m.n === 1 && !isFoundation(m.from)) return m;
    return null;
  }

  function legal(s: PileState): PileMove[] {
    const out: PileMove[] = [];
    const targets = r.targets(s);
    for (const from of r.sources(s)) {
      const pile = s.piles[from];
      for (let n = 1; n <= pile.length; n++) {
        if (!r.canPick(s, from, n)) continue;
        const moving = pile.slice(pile.length - n);
        for (const to of targets) {
          if (to === from) continue;
          if (r.maxMove && n > r.maxMove(s, to)) continue;
          if (r.canDrop(s, moving, to, from)) out.push({ t: 'move', from, n, to });
        }
      }
    }
    if (r.stock(s)) out.push({ t: 'stock' });
    return out;
  }

  /** Higher = better. Negative = pointless (never suggested). */
  function score(s: PileState, m: PileMove): number {
    if (m.t === 'stock') return 1;
    const src = s.piles[m.from];
    const dst = s.piles[m.to];
    const rest = src.length - m.n;
    const reveals = rest > 0 && !src[rest - 1].up;
    const clears = rest === 0;
    if (isFoundation(m.from)) return -1;               // never pull back from a foundation in a hint
    if (isFoundation(m.to)) return 100 + (reveals ? 20 : 0);
    if (reveals) return 80 + m.n;
    // The moving unit already sits on a card that accepts it: moving it gains nothing.
    const sitsWell = isTableau(m.from) && rest > 0 && src[rest - 1].up
      && r.canDrop({ ...s, piles: { ...s.piles, [m.from]: src.slice(0, rest) } }, src.slice(rest), m.from, m.to);
    if (isCell(m.to)) {
      // Parking a card is a hint only when it frees a card for a foundation.
      const freed = rest > 0 ? src[rest - 1] : undefined;
      const fs = Object.keys(s.piles).filter(isFoundation);
      return freed && fs.some((f) => foundationAccepts(s.piles[f], freed)) ? 2 : -1;
    }
    if (dst.length === 0) {
      if (clears || sitsWell) return -1;                // whole column to an empty one / no gain
      return isTableau(m.from) ? 10 : 30;
    }
    if (clears) return 60;
    if (isTableau(m.from)) return sitsWell ? -1 : 20;
    return 40; // from waste / cell onto the tableau
  }

  return {
    key: r.key,
    deal: r.deal,
    legal,
    apply: applyMove,
    won: r.won,
    hint(s) {
      let best: PileMove | null = null;
      let bestScore = 0;
      for (const m of legal(s)) {
        const sc = score(s, m);
        if (sc > bestScore) { best = m; bestScore = sc; }
      }
      return best;
    },
    // Cheap rule-level pre-check, then a dry run: the button shows only when the
    // foundation-only auto-play really ends in a win.
    canAutoFinish(s) {
      if (r.won(s) || !r.canAutoFinish(s)) return false;
      let cur = s;
      for (let guard = 0; guard < 200; guard++) {
        const m = finishStep(cur);
        if (!m) return false;
        cur = applyMove(cur, m)!;
        if (r.won(cur)) return true;
      }
      return false;
    },
    finishStep,
    cardsLeft: (s) => Object.entries(s.piles).filter(([id]) => !isFoundation(id)).reduce((n, [, p]) => n + p.length, 0),
  };
}
