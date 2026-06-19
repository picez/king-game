import { describe, it, expect } from 'vitest';
import { gameReducer, getCurrentPlayer, getActingPlayerId, allPenaltiesCollected } from './gameEngine';
import type { Card as CardT } from '../models/types';
import { getValidCards, cardEquals } from './rules';
import { canDiscardToKitty } from './kitty';
import { aiChooseKittyDiscards } from './ai';
import { validateDeck } from './deck';
import type { Card, GameState } from '../models/types';

function start(
  names: string[],
  modeSelectionType: 'fixed' | 'dealer_choice' = 'fixed',
): GameState {
  const state = gameReducer(null, {
    type: 'START_GAME',
    playerNames: names,
    playerTypes: names.map(() => 'human'),
    modeSelectionType,
  });
  if (!state) throw new Error('START_GAME returned null');
  return state;
}

describe('startGame — dealing (3 players, kitty taken by dealer)', () => {
  it('deals the kitty into the dealer hand and enters kitty_exchange', () => {
    const state = start(['A', 'B', 'C']);
    expect(state.players).toHaveLength(3);
    expect(state.status).toBe('kitty_exchange'); // dealer discards first, every mode

    const dealer = state.players[state.dealerIndex];
    expect(dealer.hand).toHaveLength(12); // 10 + 2 kitty
    for (const p of state.players) {
      if (p.id !== dealer.id) expect(p.hand).toHaveLength(10);
    }
    // The kitty has moved into the dealer's hand; nothing is set aside.
    expect(state.currentRound.kitty).toHaveLength(0);

    const all = state.players.flatMap((p) => p.hand);
    expect(all).toHaveLength(32);
    expect(validateDeck(all, 32)).toBe(true);
    expect(state.modeQueue).toHaveLength(9 * 3); // 27 rounds
  });

  it('after a legal discard the dealer is back to 10 cards and the round begins', () => {
    const state = start(['A', 'B', 'C']); // fixed → first mode no_tricks (all legal)
    const dealer = state.players[state.dealerIndex];
    const discards = dealer.hand.slice(0, 2);

    const next = gameReducer(state, { type: 'EXCHANGE_KITTY', discards })!;
    expect(next.status).toBe('playing'); // no_tricks is not trump
    const dealerAfter = next.players[next.dealerIndex];
    expect(dealerAfter.hand).toHaveLength(10);

    // Discarded cards leave the game: not in any hand, not in collectedCards.
    const inPlay = next.players.flatMap((p) => p.hand);
    expect(inPlay).toHaveLength(30); // 32 dealt − 2 discarded
    for (const d of discards) {
      expect(inPlay.some((c) => cardEquals(c, d))).toBe(false);
      for (const pid of Object.keys(next.currentRound.collectedCards)) {
        expect(next.currentRound.collectedCards[pid].some((c) => cardEquals(c, d))).toBe(false);
      }
    }
  });
});

describe('startGame — dealing (4 players, no kitty)', () => {
  it('deals 13 cards each and goes straight to playing for a negative mode', () => {
    const state = start(['A', 'B', 'C', 'D']);
    expect(state.players).toHaveLength(4);
    expect(state.status).toBe('playing');
    for (const p of state.players) expect(p.hand).toHaveLength(13);
    expect(state.currentRound.kitty).toHaveLength(0);

    const all = state.players.flatMap((p) => p.hand);
    expect(all).toHaveLength(52);
    expect(validateDeck(all, 52)).toBe(true);
    expect(state.modeQueue).toHaveLength(9 * 4); // 36 rounds
  });
});

describe('EXCHANGE_KITTY — illegal discards are rejected (authoritative)', () => {
  it('rejects discarding a penalty card of the current mode', () => {
    // Drive a Dealer's-Choice round into no_hearts so hearts become illegal.
    let setup: GameState | null = null;
    for (let attempt = 0; attempt < 100 && !setup; attempt++) {
      const s0 = start(['A', 'B', 'C'], 'dealer_choice'); // status: mode_selection
      const s1 = gameReducer(s0, { type: 'CHOOSE_MODE', modeId: 'no_hearts' })!;
      const dealer = s1.players[s1.dealerIndex];
      const heart = dealer.hand.find((c) => c.suit === 'hearts');
      const nonHearts = dealer.hand.filter((c) => c.suit !== 'hearts').slice(0, 2);
      if (heart && nonHearts.length === 2) setup = s1;
    }
    expect(setup).not.toBeNull();
    const s1 = setup!;
    const dealer = s1.players[s1.dealerIndex];
    const heart = dealer.hand.find((c) => c.suit === 'hearts')!;
    const nonHearts = dealer.hand.filter((c) => c.suit !== 'hearts').slice(0, 2);

    expect(canDiscardToKitty(heart, 'no_hearts')).toBe(false);

    // Illegal: includes a heart → reducer rejects, state unchanged.
    const rejected = gameReducer(s1, { type: 'EXCHANGE_KITTY', discards: [heart, nonHearts[0]] })!;
    expect(rejected).toBe(s1);

    // Legal: two non-hearts → accepted, round begins.
    const accepted = gameReducer(s1, { type: 'EXCHANGE_KITTY', discards: nonHearts })!;
    expect(accepted.status).toBe('playing');
    expect(accepted.players[accepted.dealerIndex].hand).toHaveLength(10);
  });
});

describe('AI never chooses illegal kitty discards', () => {
  it('skips penalty cards for the active mode', () => {
    const hand: Card[] = [
      { suit: 'hearts', rank: '7', value: 1 },
      { suit: 'hearts', rank: 'A', value: 8 },
      { suit: 'spades', rank: 'K', value: 7 },
      { suit: 'clubs', rank: '9', value: 3 },
    ];
    const discards = aiChooseKittyDiscards(hand, 2, 'no_hearts');
    expect(discards).toHaveLength(2);
    expect(discards.every((c) => canDiscardToKitty(c, 'no_hearts'))).toBe(true);
    expect(discards.some((c) => c.suit === 'hearts')).toBe(false);
  });
});

describe('PLAY_CARD validity (4-player game, plays immediately)', () => {
  it('accepts a valid card and adds it to the trick', () => {
    const state = start(['A', 'B', 'C', 'D']);
    const player = getCurrentPlayer(state);
    const card = getValidCards(player.hand, null)[0];

    const next = gameReducer(state, { type: 'PLAY_CARD', playerId: player.id, card })!;
    expect(next.currentTrick?.plays).toHaveLength(1);
    expect(next.players.find((p) => p.id === player.id)!.hand).toHaveLength(12);
  });

  it('ignores a play from a player who is not on turn', () => {
    const state = start(['A', 'B', 'C', 'D']);
    const onTurn = getCurrentPlayer(state);
    const offTurn = state.players.find((p) => p.id !== onTurn.id)!;
    const next = gameReducer(state, { type: 'PLAY_CARD', playerId: offTurn.id, card: offTurn.hand[0] })!;
    expect(next).toBe(state);
  });

  it('enforces following the led suit', () => {
    const state = start(['A', 'B', 'C', 'D']);
    const leader = getCurrentPlayer(state);
    const leadCard = getValidCards(leader.hand, null)[0];
    const afterLead = gameReducer(state, {
      type: 'PLAY_CARD', playerId: leader.id, card: leadCard,
    })!;

    const follower = getCurrentPlayer(afterLead);
    const ledSuit = leadCard.suit;
    const offSuit = follower.hand.find((c) => c.suit !== ledSuit);
    const hasLedSuit = follower.hand.some((c) => c.suit === ledSuit);

    if (offSuit && hasLedSuit) {
      const rejected = gameReducer(afterLead, {
        type: 'PLAY_CARD', playerId: follower.id, card: offSuit,
      })!;
      expect(rejected.currentTrick?.plays).toHaveLength(1);
    }
  });
});

describe('per-dealer mode sets (Dealer\'s Choice)', () => {
  function sumCounts(counts: Record<string, number>): number {
    return Object.values(counts).reduce((a, b) => a + b, 0);
  }

  it('3 players: each dealer owns 9 games, Trump ×3', () => {
    const state = start(['A', 'B', 'C'], 'dealer_choice');
    expect(state.players).toHaveLength(3);
    for (const p of state.players) {
      const counts = state.dealerModes[p.id];
      expect(sumCounts(counts)).toBe(9);
      expect(counts.trump).toBe(3);
      expect(counts.no_tricks).toBe(1);
      expect(counts.king_of_hearts).toBe(1);
    }
    // Each dealer is scheduled exactly 9 times across 27 rounds.
    expect(state.modeQueue).toHaveLength(27);
    for (let seat = 0; seat < 3; seat++) {
      expect(state.modeQueue.filter((e) => e.dealerIdx === seat)).toHaveLength(9);
    }
  });

  it('4 players: each dealer owns 9 games across 36 rounds', () => {
    const state = start(['A', 'B', 'C', 'D'], 'dealer_choice');
    for (const p of state.players) {
      expect(sumCounts(state.dealerModes[p.id])).toBe(9);
      expect(state.dealerModes[p.id].trump).toBe(3);
    }
    expect(state.modeQueue).toHaveLength(36);
    for (let seat = 0; seat < 4; seat++) {
      expect(state.modeQueue.filter((e) => e.dealerIdx === seat)).toHaveLength(9);
    }
  });

  it('choosing Trump decrements only that dealer\'s Trump count (3 → 2)', () => {
    const state = start(['A', 'B', 'C'], 'dealer_choice');
    const dealerId = state.players[state.dealerIndex].id;
    const otherId = state.players.find((p) => p.id !== dealerId)!.id;

    const next = gameReducer(state, { type: 'CHOOSE_MODE', modeId: 'trump' })!;
    expect(next.dealerModes[dealerId].trump).toBe(2); // this dealer used one Trump
    expect(next.dealerModes[otherId].trump).toBe(3);  // others untouched
  });

  it('one dealer choosing a mode does not remove it for other dealers', () => {
    const state = start(['A', 'B', 'C'], 'dealer_choice');
    const dealerId = state.players[state.dealerIndex].id;

    const next = gameReducer(state, { type: 'CHOOSE_MODE', modeId: 'no_queens' })!;
    expect(next.dealerModes[dealerId].no_queens).toBe(0); // used up for this dealer
    for (const p of next.players) {
      if (p.id !== dealerId) expect(next.dealerModes[p.id].no_queens).toBe(1);
    }
  });

  it('rejects a mode the dealer has already used up', () => {
    const state = start(['A', 'B', 'C'], 'dealer_choice');
    const used = gameReducer(state, { type: 'CHOOSE_MODE', modeId: 'no_tricks' })!;
    // Back in mode_selection for the same dealer would reject no_tricks again,
    // but to test the guard directly we re-enter mode_selection on a clone.
    const reentered = { ...used, status: 'mode_selection' as const };
    const rejected = gameReducer(reentered, { type: 'CHOOSE_MODE', modeId: 'no_tricks' })!;
    expect(rejected).toBe(reentered); // count was 0 → unchanged
  });

  it('state has no global availableModes field (per-dealer only)', () => {
    const state = start(['A', 'B', 'C'], 'dealer_choice');
    expect((state as Record<string, unknown>).availableModes).toBeUndefined();
    expect(state.dealerModes).toBeDefined();
  });
});

describe('game ends after the full set of rounds', () => {
  it('3 players: finishes after 27 rounds', () => {
    const state = start(['A', 'B', 'C'], 'dealer_choice');
    expect(state.modeQueue).toHaveLength(27);
    const atEnd = { ...state, status: 'round_scoring' as const, currentRoundIdx: 26 };
    expect(gameReducer(atEnd, { type: 'NEXT_ROUND' })!.status).toBe('game_finished');
    const midGame = { ...state, status: 'round_scoring' as const, currentRoundIdx: 10 };
    expect(gameReducer(midGame, { type: 'NEXT_ROUND' })!.status).not.toBe('game_finished');
  });

  it('4 players: finishes after 36 rounds', () => {
    const state = start(['A', 'B', 'C', 'D'], 'dealer_choice');
    expect(state.modeQueue).toHaveLength(36);
    const atEnd = { ...state, status: 'round_scoring' as const, currentRoundIdx: 35 };
    expect(gameReducer(atEnd, { type: 'NEXT_ROUND' })!.status).toBe('game_finished');
  });
});

describe('dealer leads the first trick', () => {
  it('4 players: the dealer is the first actor when play begins', () => {
    const state = start(['A', 'B', 'C', 'D']); // fixed, no_tricks → playing immediately
    expect(state.status).toBe('playing');
    expect(state.currentLeaderIdx).toBe(state.dealerIndex);
    expect(getActingPlayerId(state)).toBe(`player-${state.dealerIndex}`);
  });

  it('3 players: after kitty exchange the dealer leads', () => {
    const state = start(['A', 'B', 'C']); // 3p → kitty_exchange
    const dealerSeat = state.dealerIndex;
    const dealer = state.players[dealerSeat];
    const next = gameReducer(state, { type: 'EXCHANGE_KITTY', discards: dealer.hand.slice(0, 2) })!;
    expect(next.status).toBe('playing'); // no_tricks
    expect(getActingPlayerId(next)).toBe(`player-${dealerSeat}`);
  });
});

describe('allPenaltiesCollected (early round end)', () => {
  const card = (suit: CardT['suit'], rank: CardT['rank']): CardT => ({ suit, rank, value: 1 });
  const hearts32 = Array.from({ length: 8 }, (_, i) => card('hearts', String(i) as CardT['rank']));

  it('no_hearts: true only once all hearts are collected (32-deck = 8)', () => {
    expect(allPenaltiesCollected('no_hearts', { a: hearts32 }, 32)).toBe(true);
    expect(allPenaltiesCollected('no_hearts', { a: hearts32.slice(0, 7) }, 32)).toBe(false);
  });

  it('no_queens / no_jacks: true at 4 collected', () => {
    const qs = ['Q', 'Q', 'Q', 'Q'].map((r, i) => card((['spades', 'hearts', 'diamonds', 'clubs'] as const)[i], r as CardT['rank']));
    expect(allPenaltiesCollected('no_queens', { a: qs }, 32)).toBe(true);
    expect(allPenaltiesCollected('no_queens', { a: qs.slice(0, 3) }, 32)).toBe(false);
    const js = qs.map((c) => ({ ...c, rank: 'J' as CardT['rank'] }));
    expect(allPenaltiesCollected('no_jacks', { a: js }, 32)).toBe(true);
  });

  it('king_of_hearts: true once K♥ is collected', () => {
    expect(allPenaltiesCollected('king_of_hearts', { a: [card('hearts', 'K')] }, 32)).toBe(true);
    expect(allPenaltiesCollected('king_of_hearts', { a: [card('spades', 'K')] }, 32)).toBe(false);
  });

  it('no_tricks / last_two_tricks / trump: never end early', () => {
    expect(allPenaltiesCollected('no_tricks', { a: hearts32 }, 32)).toBe(false);
    expect(allPenaltiesCollected('last_two_tricks', { a: hearts32 }, 32)).toBe(false);
    expect(allPenaltiesCollected('trump', { a: hearts32 }, 32)).toBe(false);
  });
});

describe('getActingPlayerId', () => {
  it('returns the dealer during kitty_exchange', () => {
    const state = start(['A', 'B', 'C']);
    expect(state.status).toBe('kitty_exchange');
    expect(getActingPlayerId(state)).toBe(state.players[state.dealerIndex].id);
  });

  it('returns the current player while playing', () => {
    const state = start(['A', 'B', 'C', 'D']);
    expect(getActingPlayerId(state)).toBe(getCurrentPlayer(state).id);
  });
});
