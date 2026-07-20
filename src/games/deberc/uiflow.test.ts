// ---------------------------------------------------------------------------
// Regression: the LOCAL/ONLINE UI drives the reducer with actions built exactly
// the way DebercGameScreen builds them (announce = every truthfully-held meld via
// detectAllSequences + bella with topRank = cards[last].rank; play = a card from
// currentLegalPlays). This guards against a UI action the reducer would REJECT
// (returns the same state ref), which in the app manifests as a FREEZE — the
// player clicks and nothing happens (React does not re-render on an unchanged
// state, and online the server sends an error without advancing). See the owner's
// "game froze on the second move" report.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { debercReducer, getActingDebercPlayerId, currentLegalPlays } from './engine';
import { debercBotAction } from './ai';
import { isLegalPlay } from './rules';
import { detectAllSequences } from './melds';
import type { DebercAction, DebercState } from './types';

/** Seat 0's action, built EXACTLY as the DebercGameScreen UI builds it. */
function uiAction(state: DebercState, playIndex: number): DebercAction {
  if (state.phase === 'declaring') {
    // v1.6: bella is NO LONGER declared here — only truthfully-held sequences.
    const seat = state.meldTurnSeat;
    const hand = state.dealtHands[seat] ?? state.players[seat].hand;
    const melds = detectAllSequences(hand, seat, state.trumpSuit);
    return {
      type: 'DECLARE_MELD',
      melds: melds.map((m) => ({ kind: m.kind, topRank: m.cards[m.cards.length - 1].rank, suit: m.cards[0].suit })),
    };
  }
  if (state.phase === 'playing') {
    const seat = state.turnSeat;
    const legal = currentLegalPlays(state);
    const card = legal[playIndex % legal.length];
    // v1.6 bella at play time: arm бела exactly as the UI would when playing a trump
    // K/Q while eligible + undeclared (exercises the declareBela reducer path).
    const isHonor = state.trumpSuit != null && card.suit === state.trumpSuit && (card.rank === 'K' || card.rank === 'Q');
    if (isHonor && state.bellaEligible.includes(seat) && state.bellaDeclaredBy == null) {
      return { type: 'PLAY_CARD', card, declareBela: true };
    }
    return { type: 'PLAY_CARD', card };
  }
  return debercBotAction(state)!; // bidding — always accepted
}

function drive(players: 3 | 4, matchSize: 'small' | 'big', seed: number): DebercState {
  const rng = makeRng(seed);
  const names = Array.from({ length: players }, (_, i) => (i === 0 ? 'You' : `Bot ${i}`));
  const types = names.map((_, i) => (i === 0 ? 'human' : 'ai') as 'human' | 'ai');
  let state = debercReducer(null, { type: 'START_DEBERC', playerNames: names, playerTypes: types, matchSize }, { rng })!;
  let steps = 0;
  let playIndex = 0;
  while (state.phase !== 'finished' && steps++ < 20000) {
    const phase = state.phase;
    let action: DebercAction;
    if (phase === 'trick_complete') action = { type: 'NEXT_TRICK' };
    else if (phase === 'hand_scoring') action = { type: 'NEXT_HAND' };
    else {
      const id = getActingDebercPlayerId(state);
      const seat = id ? Number(id.split('-')[1]) : -1;
      if (seat === 0) { action = uiAction(state, playIndex++); }
      else action = debercBotAction(state)!;
    }
    // In 'playing', verify the UI's legal set matches the reducer exactly.
    if (phase === 'playing') {
      const seat = state.turnSeat;
      const hand = state.players[seat].hand;
      const led = state.currentTrick ? state.currentTrick.ledSuit : null;
      for (const c of currentLegalPlays(state)) {
        expect(isLegalPlay(c, hand, led, state.trumpSuit)).toBe(true);
      }
    }
    const next = debercReducer(state, action, { rng });
    // The core assertion: a UI-built action NEVER leaves the state unchanged
    // (which would freeze the app).
    expect(next, `stalled in phase ${phase} on ${JSON.stringify(action)}`).not.toBe(state);
    state = next!;
  }
  expect(state.phase).toBe('finished');
  return state;
}

describe('deberc UI action flow never stalls (freeze regression)', () => {
  for (const players of [3, 4] as const) {
    for (const matchSize of ['small', 'big'] as const) {
      it(`drives ${players}p ${matchSize} to a finish with UI-built human actions`, () => {
        for (let seed = 1; seed <= 8; seed++) drive(players, matchSize, seed);
      });
    }
  }
});

describe('деберц об\'яз rotation (§3)', () => {
  it('the hand winner becomes the next dealer/об\'яз before bidding', () => {
    // Drive to the first NEXT_HAND, capture the hand's top scorer, then confirm the
    // freshly dealt hand opens with that team's representative as dealer/об'яз.
    const rng = makeRng(123);
    let state = debercReducer(null, { type: 'START_DEBERC', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'], matchSize: 'small' }, { rng })!;
    let steps = 0;
    while (steps++ < 20000) {
      if (state.phase === 'hand_scoring') {
        const after = debercReducer(state, { type: 'NEXT_HAND' }, { rng })!;
        if (after.phase === 'finished') break;
        // NEXT_HAND scores the hand (populating lastHand) THEN deals the next one.
        const top = after.lastHand!.topScorerTeam; // the just-scored hand's winner
        const seatsOfTop = after.teamOf
          .map((tm, seat) => ({ tm, seat }))
          .filter((x) => x.tm === top)
          .map((x) => x.seat);
        // A fresh hand opens in bidding with dealerSeat === objazSeat === winner rep.
        expect(after.phase).toBe('bidding');
        expect(after.dealerSeat).toBe(after.objazSeat);
        expect(seatsOfTop).toContain(after.dealerSeat);
        return;
      }
      const phase = state.phase;
      const action: DebercAction = phase === 'trick_complete' ? { type: 'NEXT_TRICK' } : debercBotAction(state)!;
      state = debercReducer(state, action, { rng })!;
    }
    throw new Error('no hand was scored');
  });
});
