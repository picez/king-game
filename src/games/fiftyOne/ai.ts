// ---------------------------------------------------------------------------
// 51 — deterministic, legal-first bot (no RNG in the decision, so replays are
// stable). Greedy, not optimal (51_PLAN.md "Bot MVP"):
//   1. Draw: take the discard top only if it extends an existing public meld and
//      the bot has opened; otherwise draw from the pile.
//   2. If not opened and it can assemble melds from its own hand totalling ≥ 51
//      (leaving a card to discard), open them.
//   3. If opened, lay off any trivially-fitting card to shrink the hand.
//   4. Discard the highest-value "deadweight" card (one not in any candidate
//      meld), keeping meld-useful cards. Jokers are kept unless forced.
// It never makes an illegal move and always ends the turn on a legal discard.
// ---------------------------------------------------------------------------

import { resolveMeld, rankValue } from './melds';
import { topDiscard } from './rules';
import type { Rank } from '../../models/types';
import type { FiftyOneAction, FiftyOneCard, FiftyOneMeld, FiftyOneState } from './types';

/** Discard-ranking weight of a card: jokers are precious (kept), else §10 value. */
function discardWeight(c: FiftyOneCard): number {
  return c.joker ? 0 : rankValue(c.rank as Rank);
}

interface Candidate {
  cards: FiftyOneCard[];
  value: number;
}

/** Loosely propose melds from a hand; each proposal is confirmed+valued by
 *  resolveMeld, so over-generation is harmless. */
function candidateMelds(hand: FiftyOneCard[]): Candidate[] {
  const out: Candidate[] = [];
  const jokers = hand.filter((c) => c.joker);
  const joker = jokers.length > 0 ? jokers[0] : null;
  const push = (cards: FiftyOneCard[]): void => {
    const r = resolveMeld(cards);
    if (r) out.push({ cards, value: r.value });
  };

  // --- Sets (by rank, one card per distinct suit) ---
  const byRank = new Map<string, FiftyOneCard[]>();
  for (const c of hand) {
    if (c.joker) continue;
    const list = byRank.get(c.rank as string) ?? [];
    list.push(c);
    byRank.set(c.rank as string, list);
  }
  for (const cards of byRank.values()) {
    const distinct: FiftyOneCard[] = [];
    const seen = new Set<string>();
    for (const c of cards) {
      if (!seen.has(c.suit as string)) {
        seen.add(c.suit as string);
        distinct.push(c);
      }
    }
    if (distinct.length >= 3) {
      push(distinct.slice(0, 4));
      push(distinct.slice(0, 3));
    } else if (distinct.length === 2 && joker) {
      push([...distinct, joker]);
    }
  }

  // --- Runs (by suit) ---
  const bySuit = new Map<string, Map<number, FiftyOneCard>>();
  const posHigh = (c: FiftyOneCard): number => {
    switch (c.rank) {
      case 'A': return 14;
      case 'K': return 13;
      case 'Q': return 12;
      case 'J': return 11;
      default: return Number(c.rank);
    }
  };
  for (const c of hand) {
    if (c.joker) continue;
    const m = bySuit.get(c.suit as string) ?? new Map<number, FiftyOneCard>();
    const p = posHigh(c);
    if (!m.has(p)) m.set(p, c); // ignore the duplicate copy from a 2nd deck
    bySuit.set(c.suit as string, m);
  }
  for (const posMap of bySuit.values()) {
    const positions = [...posMap.keys()].sort((a, b) => a - b);
    // Maximal consecutive blocks (length ≥ 3), plus their 3-card prefix.
    for (let i = 0; i < positions.length; ) {
      let j = i;
      while (j + 1 < positions.length && positions[j + 1] === positions[j] + 1) j++;
      if (j - i >= 2) {
        const block = positions.slice(i, j + 1).map((p) => posMap.get(p) as FiftyOneCard);
        push(block);
        if (block.length > 3) push(block.slice(0, 3));
      }
      i = j + 1;
    }
    // Joker-bridged triple: p and p+2 present, p+1 missing.
    if (joker) {
      for (const p of positions) {
        if (posMap.has(p) && posMap.has(p + 2) && !posMap.has(p + 1)) {
          push([posMap.get(p) as FiftyOneCard, joker, posMap.get(p + 2) as FiftyOneCard]);
        }
      }
    }
    // A-2-3 (Ace low): A(14) 2 3, with an optional internal joker as the 2.
    const a = posMap.get(14);
    const two = posMap.get(2);
    const three = posMap.get(3);
    if (a && two && three) push([a, two, three]);
    if (joker && a && three && !two) push([a, joker, three]);
  }

  return out;
}

/** Greedily choose an opening lay-down (≥ 51, leaving ≥ 1 card), or null. */
function chooseOpening(hand: FiftyOneCard[]): FiftyOneCard[][] | null {
  const cands = candidateMelds(hand).sort((x, y) => y.value - x.value);
  const used = new Set<string>();
  const chosen: Candidate[] = [];
  for (const cand of cands) {
    if (cand.cards.some((c) => used.has(c.id))) continue;
    for (const c of cand.cards) used.add(c.id);
    chosen.push(cand);
  }
  const total = () => chosen.reduce((s, c) => s + c.value, 0);
  // Ensure at least one card remains to discard; drop the smallest meld(s) if not.
  while (chosen.length > 0 && hand.length - used.size < 1) {
    const dropped = chosen.pop() as Candidate;
    for (const c of dropped.cards) used.delete(c.id);
  }
  if (chosen.length === 0 || total() < 51 || hand.length - used.size < 1) return null;
  return chosen.map((c) => c.cards);
}

/** A card that can be laid off onto an existing public meld, or null. */
function chooseLayoff(hand: FiftyOneCard[], melds: FiftyOneMeld[]): { meldId: string; card: FiftyOneCard } | null {
  if (hand.length < 2) return null; // keep the last card to discard / go out
  for (const card of hand) {
    for (const m of melds) {
      if (resolveMeld([...m.cards, card])) return { meldId: m.id, card };
    }
  }
  return null;
}

/** The highest-value deadweight card to discard (keeps meld-useful cards). */
function chooseDiscard(hand: FiftyOneCard[]): FiftyOneCard {
  const nonJokers = hand.filter((c) => !c.joker);
  if (nonJokers.length === 0) return hand[0]; // forced to shed a joker
  const inMeld = new Set<string>();
  for (const cand of candidateMelds(hand)) for (const c of cand.cards) inMeld.add(c.id);
  const free = nonJokers.filter((c) => !inMeld.has(c.id));
  const pool = free.length > 0 ? free : nonJokers;
  return pool.reduce((hi, c) => (discardWeight(c) > discardWeight(hi) ? c : hi));
}

/** Choose one legal action for the acting seat. */
export function fiftyOneBotAction(state: FiftyOneState, seat: number): FiftyOneAction {
  if (state.phase === 'round_complete' || state.phase === 'game_finished') {
    return { type: 'START_NEXT_ROUND' };
  }

  const hand = state.handsBySeat[seat];
  const opened = state.openedBySeat[seat];

  if (state.turnStep === 'draw') {
    const top = topDiscard(state);
    if (opened && top) {
      for (const m of state.publicMelds) {
        if (resolveMeld([...m.cards, top])) return { type: 'TAKE_DISCARD' };
      }
    }
    return { type: 'DRAW_FROM_DECK' };
  }

  // meld_discard
  if (!opened) {
    const opening = chooseOpening(hand);
    if (opening) return { type: 'OPEN_MELDS', melds: opening };
  } else {
    const layoff = chooseLayoff(hand, state.publicMelds);
    if (layoff) return { type: 'ADD_TO_MELD', meldId: layoff.meldId, cards: [layoff.card] };
  }
  return { type: 'DISCARD', card: chooseDiscard(hand) };
}
