// ---------------------------------------------------------------------------
// Poker — deterministic, fair MVP bot (§12). Decides ONLY from its own hole
// cards, the public board, the pot/stacks and its legal actions. It never reads
// the deck order, burns or any opponent's hole cards. Pre-flop uses hole-card
// strength tiers; post-flop uses the made-hand category + simple draw awareness.
// Always returns a LEGAL action. Deterministic: same state → same move.
// ---------------------------------------------------------------------------

import type { Rank, Suit } from '../../models/types';
import { bestHand, rankValue } from './handEval';
import { legalActions } from './rules';
import type { PokerAction, PokerCard, PokerState } from './types';

/** Pre-flop hand strength in [0,1] from the two hole cards. */
function preflopStrength(hole: PokerCard[]): number {
  const [a, b] = hole;
  const ra = rankValue(a.rank as Rank);
  const rb = rankValue(b.rank as Rank);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const suited = a.suit === b.suit;
  const gap = hi - lo;
  if (ra === rb) return Math.min(1, 0.5 + (ra / 28));          // any pair: 0.57..1.0
  let s = (hi + lo) / 40;                                       // high-card weight
  if (suited) s += 0.1;
  if (gap === 1) s += 0.08;                                     // connected
  else if (gap === 2) s += 0.04;
  if (hi === 14) s += 0.06;                                     // an ace
  return Math.min(0.72, s);                                     // unpaired capped below premium
}

/** Category → base made-hand strength. */
function categoryStrength(cards: PokerCard[]): number {
  const { category } = bestHand(cards);
  switch (category) {
    case 'royal_flush':
    case 'straight_flush':
    case 'four_of_a_kind': return 0.99;
    case 'full_house': return 0.95;
    case 'flush': return 0.9;
    case 'straight': return 0.85;
    case 'three_of_a_kind': return 0.8;
    case 'two_pair': return 0.68;
    case 'one_pair': return 0.45;
    default: return 0.18;
  }
}

/** Draw bonus: 4-flush or open-ended 4-straight among the known cards. */
function drawBonus(cards: PokerCard[]): number {
  const suits = new Map<Suit, number>();
  for (const c of cards) if (c.suit) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
  let bonus = 0;
  if ([...suits.values()].some((v) => v === 4)) bonus += 0.2; // flush draw
  const ranks = Array.from(new Set(cards.map((c) => rankValue(c.rank as Rank)))).sort((x, y) => x - y);
  for (let i = 0; i + 3 < ranks.length; i++) {
    if (ranks[i + 3] - ranks[i] === 3) { bonus += 0.15; break; } // open-ended straight draw
  }
  return bonus;
}

/** Overall strength [0,1] for the acting seat. */
function handStrength(state: PokerState, seat: number): number {
  const hole = state.holeCardsBySeat[seat];
  if (state.board.length === 0) return preflopStrength(hole);
  const cards = [...hole, ...state.board];
  const made = categoryStrength(cards);
  const strength = made + (made < 0.6 ? drawBonus(cards) : 0);
  return Math.min(1, strength);
}

/** Choose one legal action for the acting seat. */
export function pokerBotAction(state: PokerState, seat: number): PokerAction {
  if (state.phase === 'hand_complete' || state.phase === 'game_finished') {
    return { type: 'START_NEXT_HAND' };
  }
  const la = legalActions(state, seat);
  if (!la.canFold && !la.canCheck && !la.canCall) return { type: 'FOLD' }; // cannot act (defensive)

  const s = handStrength(state, seat);
  const pot = state.contributedBySeat.reduce((a, b) => a + b, 0);
  const stack = state.stacksBySeat[seat];

  // No bet to call — check or make a value bet.
  if (la.canCheck) {
    if (s >= 0.75 && la.canBet) {
      const target = clampBet(la.minBet, la.maxTo, la.minBet + Math.round(pot * 0.5));
      return s >= 0.9 && stack <= pot ? { type: 'ALL_IN' } : { type: 'BET', amount: target };
    }
    return { type: 'CHECK' };
  }

  // Facing a bet — fold / call / raise on pot odds + strength.
  const call = la.callAmount;
  if (s >= 0.85) {
    if (la.canRaise) {
      const target = clampBet(la.minRaiseTo, la.maxTo, la.minRaiseTo + Math.round(pot * 0.5));
      return { type: 'RAISE', amount: target };
    }
    return { type: 'CALL' };
  }
  if (s >= 0.5 || call <= Math.max(1, Math.round(pot * 0.25))) {
    return { type: 'CALL' };
  }
  return { type: 'FOLD' };
}

/** Keep a proposed bet total within [min,max] (all-in when it reaches the cap). */
function clampBet(min: number, max: number, target: number): number {
  return Math.max(min, Math.min(max, target));
}
