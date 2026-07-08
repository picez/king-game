// ---------------------------------------------------------------------------
// King setup search — perfect-information rollout for the dealer's TRUMP-suit
// and KITTY-discard decisions.
//
// The server bot legally sees every hand (like the endgame lookahead in
// lookahead.ts), so the dealer's setup choices can be scored by actually PLAYING
// THE ROUND OUT: for each candidate, apply it via the real reducer, roll the
// whole round forward with the greedy heuristic for every seat, and read off the
// dealer's resulting round score. Because King scoring is "higher is always
// better for every seat" (penalties negative, Trump positive), the best choice is
// simply the one with the greatest dealer round-delta — uniform across all modes.
//
// This replaces the static aiChooseTrump / aiChooseKittyDiscards heuristics for
// the SERVER bot only (botAction). Those heuristics remain the fallback and the
// choice for any caller without a full-information state. Rollouts are cheap and
// happen once per round (a setup step), so the cost is negligible.
// ---------------------------------------------------------------------------

import type { Card, GameState, Suit } from '../models/types';
import { gameReducer, getCurrentPlayer } from './gameEngine';
import { aiChooseCard, aiChooseTrump, aiChooseKittyDiscards } from './ai';
import { getValidKittyDiscards } from './kitty';

const ALL_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

// Cap the number of discard combinations we roll out. C(9,3)=84 is fine, but a
// larger kitty/hand (custom config) could blow up; beyond this we fall back to
// the static heuristic's pick as the sole candidate. Sized to stay a few ms.
const MAX_DISCARD_COMBOS = 220;

/**
 * Play a 'playing'/'trick_complete' state forward to the end of the CURRENT round
 * with the greedy heuristic for every seat, and return the round-score delta for
 * `seat` (points that seat gains from `state` to round end). Deterministic —
 * aiChooseCard has no rng. Stops at round_scoring/game_finished (does not deal on).
 */
function rolloutRoundScore(state: GameState, seat: number): number {
  const pid = state.players[seat].id;
  const before = state.scores[pid]?.total ?? 0;
  let s = state;
  for (let guard = 0; guard < 2000; guard++) {
    if (s.status === 'round_scoring' || s.status === 'game_finished') break;
    if (s.status === 'trick_complete') { s = gameReducer(s, { type: 'NEXT_TRICK' })!; continue; }
    if (s.status === 'playing') {
      const p = getCurrentPlayer(s);
      s = gameReducer(s, { type: 'PLAY_CARD', playerId: p.id, card: aiChooseCard(s) })!;
      continue;
    }
    break; // unexpected screen — bail with what we have
  }
  return (s.scores[pid]?.total ?? 0) - before;
}

/** All size-`k` combinations of `arr` (order-independent), capped by the caller. */
function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const combo: T[] = [];
  const rec = (start: number): void => {
    if (combo.length === k) { out.push(combo.slice()); return; }
    for (let i = start; i <= arr.length - (k - combo.length); i++) {
      combo.push(arr[i]);
      rec(i + 1);
      combo.pop();
    }
  };
  rec(0);
  return out;
}

/**
 * The dealer's kitty discards chosen by rolling out each legal combination and
 * keeping the one that yields the dealer's best round score. `state` must be a
 * `kitty_exchange` state (full information). Falls back to the static heuristic
 * when the combination count would be too large.
 */
export function chooseKittyDiscardsLookahead(state: GameState): Card[] {
  const dealer = state.players[state.dealerIndex];
  const seat = dealer.seatIndex;
  const kittySize = state.config.kittySize;
  const modeId = state.currentRound.mode.id;
  const legal = getValidKittyDiscards(dealer.hand, modeId);
  if (legal.length <= kittySize) return legal.slice(0, kittySize);

  const combos = combinations(legal, kittySize);
  if (combos.length > MAX_DISCARD_COMBOS) {
    return aiChooseKittyDiscards(dealer.hand, kittySize, modeId);
  }

  let best = combos[0];
  let bestScore = -Infinity;
  for (const discards of combos) {
    const next = gameReducer(state, { type: 'EXCHANGE_KITTY', discards });
    if (!next) continue;
    const score = rolloutRoundScore(next, seat);
    if (score > bestScore) { bestScore = score; best = discards; }
  }
  return best;
}

/**
 * The dealer's trump suit chosen by rolling out each of the four suits (including
 * the kitty exchange that follows) and keeping the one with the dealer's best
 * round score. `state` must be a `select_trump` state. Returns null only if every
 * candidate fails to apply (shouldn't happen) — the caller then uses the static
 * heuristic.
 */
export function chooseTrumpLookahead(state: GameState): Suit | null {
  const dealer = state.players[state.dealerIndex];
  const seat = dealer.seatIndex;

  let best: Suit | null = null;
  let bestScore = -Infinity;
  for (const suit of ALL_SUITS) {
    const afterTrump = gameReducer(state, { type: 'SELECT_TRUMP', suit });
    if (!afterTrump) continue;
    // 3-player rounds now take the kitty; 4-player rounds go straight to play.
    let playState = afterTrump;
    if (afterTrump.status === 'kitty_exchange') {
      const discards = chooseKittyDiscardsLookahead(afterTrump);
      const exchanged = gameReducer(afterTrump, { type: 'EXCHANGE_KITTY', discards });
      if (!exchanged) continue;
      playState = exchanged;
    }
    const score = rolloutRoundScore(playState, seat);
    if (score > bestScore) { bestScore = score; best = suit; }
  }
  // Defensive: if nothing applied, defer to the static heuristic on the raw hand.
  return best ?? aiChooseTrump(dealer.hand);
}
