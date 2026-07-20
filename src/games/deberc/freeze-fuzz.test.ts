// ---------------------------------------------------------------------------
// Freeze reproduction fuzz (#4 "game froze on the 2nd move"). The uiflow test
// drives the human seat declaring EVERY held meld and cycling legal plays. A real
// human can instead pick an ARBITRARY SUBSET of the offered meld chips and click
// ANY legal card — a much larger action space. This harness explores that space
// across thousands of random matches and asserts the reducer NEVER returns the
// same state reference for a UI-built action (which is exactly what freezes the
// app: setState with an unchanged ref does not re-render). If a stall exists, the
// failing seed + phase + action is printed so it can be turned into a unit test.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { debercReducer, currentLegalPlays, getActingDebercPlayerId } from './engine';
import { debercBotAction } from './ai';
import { detectAllSequences } from './melds';
import { debercRedactStateFor } from './redact';
import type { DebercAction, DebercMeld, DebercState } from './types';

/** A tiny deterministic PRNG for the human's choices, seeded per match. */
function choiceRng(seed: number): () => number {
  let x = (seed * 2654435761) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0xffffffff;
  };
}

/** The melds the DebercGameScreen would offer the human this declaring turn (v1.6:
 *  sequences only — bella is no longer declared in this phase). */
function offeredMelds(state: DebercState, seat: number): DebercMeld[] {
  const hand = state.dealtHands[seat] ?? state.players[seat].hand;
  return detectAllSequences(hand, seat, state.trumpSuit);
}

/**
 * Build seat 0's action EXACTLY as the UI does, but with RANDOM human choices:
 *  • declaring → pass, or announce a random non-empty subset of the offered chips;
 *  • playing   → a random card from currentLegalPlays;
 *  • bidding   → the bot's bid (bidding UI is a fixed set the reducer always takes).
 */
function humanAction(state: DebercState, pick: () => number): DebercAction {
  if (state.phase === 'declaring') {
    const seat = state.meldTurnSeat;
    const melds = offeredMelds(state, seat);
    // ~25% of the time pass outright (the UI's "declare pass" button).
    if (melds.length === 0 || pick() < 0.25) return { type: 'DECLARE_MELD', melds: [] };
    // Otherwise announce a random non-empty subset (the UI's chip toggles).
    let chosen = melds.filter(() => pick() < 0.5);
    if (chosen.length === 0) chosen = [melds[Math.floor(pick() * melds.length) % melds.length]];
    return {
      type: 'DECLARE_MELD',
      melds: chosen.map((m) => ({ kind: m.kind, topRank: m.cards[m.cards.length - 1].rank, suit: m.cards[0].suit })),
    };
  }
  if (state.phase === 'playing') {
    const seat = state.turnSeat;
    const legal = currentLegalPlays(state);
    const card = legal[Math.floor(pick() * legal.length) % legal.length];
    // v1.6 bella at play time: ~50% of the time, when eligible + undeclared and the
    // random card is a trump K/Q, arm бела (exercises the declareBela reducer path).
    const isHonor = state.trumpSuit != null && card.suit === state.trumpSuit && (card.rank === 'K' || card.rank === 'Q');
    if (isHonor && state.bellaEligible.includes(seat) && state.bellaDeclaredBy == null && pick() < 0.5) {
      return { type: 'PLAY_CARD', card, declareBela: true };
    }
    return { type: 'PLAY_CARD', card };
  }
  return debercBotAction(state)!; // bidding
}

/** Drive one whole match; throws (with context) the moment a UI action stalls. */
function driveMatch(players: 3 | 4, matchSize: 'small' | 'big', seed: number): void {
  const rng = makeRng(seed);
  const pick = choiceRng(seed * 31 + players * 7 + (matchSize === 'big' ? 1 : 0));
  const names = Array.from({ length: players }, (_, i) => (i === 0 ? 'You' : `Bot ${i}`));
  const types = names.map((_, i) => (i === 0 ? 'human' : 'ai') as 'human' | 'ai');
  let state = debercReducer(null, { type: 'START_DEBERC', playerNames: names, playerTypes: types, matchSize }, { rng })!;

  let steps = 0;
  while (state.phase !== 'finished' && steps++ < 40000) {
    const phase = state.phase;
    let action: DebercAction;
    if (phase === 'trick_complete') action = { type: 'NEXT_TRICK' };
    else if (phase === 'hand_scoring') action = { type: 'NEXT_HAND' };
    else {
      const id = getActingDebercPlayerId(state);
      const seat = id ? Number(id.split('-')[1]) : -1;
      action = seat === 0 ? humanAction(state, pick) : debercBotAction(state)!;
    }
    const next = debercReducer(state, action, { rng });
    // The stall assertion: a UI/bot action that the reducer rejects returns the
    // SAME ref — the app-level freeze. Fail loudly with everything needed to repro.
    if (next === state) {
      throw new Error(
        `STALL ${players}p ${matchSize} seed=${seed} step=${steps} phase=${phase} ` +
        `meldTurnSeat=${state.meldTurnSeat} turnSeat=${state.turnSeat} ` +
        `action=${JSON.stringify(action)}`,
      );
    }
    state = next!;
  }
  expect(state.phase, `did not finish ${players}p ${matchSize} seed=${seed}`).toBe('finished');
}

describe('deberc freeze fuzz — random human meld/card choices never stall (#4)', () => {
  for (const players of [3, 4] as const) {
    for (const matchSize of ['small', 'big'] as const) {
      it(`${players}p ${matchSize}: 250 random matches make progress every step`, () => {
        for (let seed = 1; seed <= 250; seed++) driveMatch(players, matchSize, seed);
      }, 60000);
    }
  }
});

/**
 * ONLINE-shaped variant: the human builds their action from the REDACTED state the
 * server sends (own hand real, opponents hidden, other seats' dealtHands stripped),
 * exactly like DebercOnlineGame → DebercGameScreen. The action is then applied to
 * the FULL server state (what the server validates). If redaction ever changed the
 * human's offered melds or legal plays, the server would reject the action (same
 * ref) and the online board would freeze — this is the precise online repro.
 */
function driveOnline(players: 3 | 4, matchSize: 'small' | 'big', seed: number): void {
  const rng = makeRng(seed);
  const pick = choiceRng(seed * 97 + players * 13 + (matchSize === 'big' ? 3 : 0));
  const names = Array.from({ length: players }, (_, i) => (i === 0 ? 'You' : `Bot ${i}`));
  const types = names.map((_, i) => (i === 0 ? 'human' : 'ai') as 'human' | 'ai');
  let state = debercReducer(null, { type: 'START_DEBERC', playerNames: names, playerTypes: types, matchSize }, { rng })!;

  let steps = 0;
  while (state.phase !== 'finished' && steps++ < 40000) {
    const phase = state.phase;
    let action: DebercAction;
    if (phase === 'trick_complete') action = { type: 'NEXT_TRICK' };
    else if (phase === 'hand_scoring') action = { type: 'NEXT_HAND' };
    else {
      const id = getActingDebercPlayerId(state);
      const seat = id ? Number(id.split('-')[1]) : -1;
      // The human (seat 0) sees only the redacted state — build the action from it.
      action = seat === 0 ? humanAction(debercRedactStateFor(state, 0), pick) : debercBotAction(state)!;
    }
    const next = debercReducer(state, action, { rng });
    if (next === state) {
      throw new Error(
        `ONLINE STALL ${players}p ${matchSize} seed=${seed} step=${steps} phase=${phase} ` +
        `action=${JSON.stringify(action)}`,
      );
    }
    state = next!;
  }
  expect(state.phase, `online did not finish ${players}p ${matchSize} seed=${seed}`).toBe('finished');
}

describe('deberc freeze fuzz — human acts on the REDACTED state, server never rejects (#4 online)', () => {
  for (const players of [3, 4] as const) {
    for (const matchSize of ['small', 'big'] as const) {
      it(`${players}p ${matchSize}: 150 redacted-view matches never stall the server`, () => {
        for (let seed = 1; seed <= 150; seed++) driveOnline(players, matchSize, seed);
      }, 60000);
    }
  }
});
