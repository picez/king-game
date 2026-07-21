import { describe, it, expect } from 'vitest';
import {
  isFinishedFiftyOneGame, summarizeFinishedFiftyOneGame, computeFiftyOneStatDeltas,
  fiftyOneFinishSignature,
} from './fiftyOneStats';
import { fiftyOneReducer } from '../games/fiftyOne/engine';
import type { FiftyOneCard, FiftyOnePlayer, FiftyOneState } from '../games/fiftyOne/types';

const card = (rank: FiftyOneCard['rank'], suit: FiftyOneCard['suit']): FiftyOneCard =>
  ({ id: `0-${suit}-${rank}`, joker: false, suit, rank });

const P = (seat: number, ai = false): FiftyOnePlayer => ({
  id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: ai ? 'ai' : 'human',
});

/**
 * A FINISHED 51 match. By default: 3 players, seat 1 is the last standing (winner),
 * seats 0 & 2 eliminated (penalty ≥ 510). Cards are intentionally OMITTED — the
 * summarizer must only ever read the public score-level fields.
 */
function finished(over: Partial<FiftyOneState> = {}): FiftyOneState {
  return {
    gameType: 'fifty-one',
    phase: 'game_finished',
    playerCount: 3,
    players: [P(0), P(1), P(2, true)],
    dealerSeat: 0, starterSeat: 1, currentSeat: 1, turnStep: 'meld_discard',
    handsBySeat: [[], [], []], drawPile: [], discardPile: [],
    openedBySeat: [true, true, true], publicMelds: [],
    scoresBySeat: [530, 210, 512],
    eliminatedSeats: [true, false, true],
    roundNumber: 9, roundWinnerSeat: 1,
    winnerSeat: 1, lastRound: null,
    options: { targetPenalty: 510 },
    ...over,
  };
}

/** A finished 2-player match (seat 0 wins, seat 1 eliminated). */
function finished2p(): FiftyOneState {
  return finished({
    playerCount: 2,
    players: [P(0), P(1, true)],
    scoresBySeat: [180, 510],
    eliminatedSeats: [false, true],
    winnerSeat: 0, roundWinnerSeat: 0, starterSeat: 1, currentSeat: 0,
    openedBySeat: [true, true], handsBySeat: [[], []],
    roundNumber: 6,
  });
}

/** A finished 4-player match (seat 2 wins, the other three eliminated). */
function finished4p(): FiftyOneState {
  return finished({
    playerCount: 4,
    players: [P(0), P(1), P(2), P(3, true)],
    scoresBySeat: [520, 515, 340, 511],
    eliminatedSeats: [true, true, false, true],
    winnerSeat: 2, roundWinnerSeat: 2, starterSeat: 0, currentSeat: 2,
    openedBySeat: [true, true, true, true], handsBySeat: [[], [], [], []],
    roundNumber: 14,
  });
}

describe('isFinishedFiftyOneGame', () => {
  it('is true only when the phase is game_finished', () => {
    expect(isFinishedFiftyOneGame(finished())).toBe(true);
    expect(isFinishedFiftyOneGame(finished({ phase: 'playing' }))).toBe(false);
    expect(isFinishedFiftyOneGame(finished({ phase: 'round_complete' }))).toBe(false);
    expect(isFinishedFiftyOneGame(null)).toBe(false);
  });
});

describe('summarizeFinishedFiftyOneGame — 2p / 3p / 4p', () => {
  it('3p: the last seat standing is the unique winner; others lost + eliminated', () => {
    const s = summarizeFinishedFiftyOneGame(finished());
    expect(s.playerCount).toBe(3);
    expect(s.winnerSeat).toBe(1);
    expect(s.winners).toEqual(['player-1']);
    expect(s.finalPenalties).toEqual([530, 210, 512]);
    expect(s.roundsPlayed).toBe(9);
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-1']).toMatchObject({ isWinner: true, finalPenalty: 210, eliminated: false });
    expect(byId['player-0']).toMatchObject({ isWinner: false, finalPenalty: 530, eliminated: true });
    expect(byId['player-2']).toMatchObject({ isWinner: false, finalPenalty: 512, eliminated: true });
    // The winner is never eliminated in the normal last-standing case.
    expect(s.players.find((p) => p.isWinner)!.eliminated).toBe(false);
  });

  it('2p: winner + one eliminated loser', () => {
    const s = summarizeFinishedFiftyOneGame(finished2p());
    expect(s.playerCount).toBe(2);
    expect(s.winnerSeat).toBe(0);
    expect(s.winners).toEqual(['player-0']);
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-0']).toMatchObject({ isWinner: true, eliminated: false, finalPenalty: 180 });
    expect(byId['player-1']).toMatchObject({ isWinner: false, eliminated: true, finalPenalty: 510 });
  });

  it('4p: exactly one winner; the other three lost + eliminated', () => {
    const s = summarizeFinishedFiftyOneGame(finished4p());
    expect(s.playerCount).toBe(4);
    expect(s.winnerSeat).toBe(2);
    expect(s.winners).toEqual(['player-2']);
    expect(s.players.filter((p) => p.isWinner)).toHaveLength(1);
    expect(s.players.filter((p) => p.eliminated)).toHaveLength(3);
    expect(s.roundsPlayed).toBe(14);
  });

  it('carries NO private card data in the summary JSON (score-level only)', () => {
    for (const st of [finished(), finished2p(), finished4p()]) {
      const json = JSON.stringify(summarizeFinishedFiftyOneGame(st));
      expect(json).not.toMatch(/"rank"|"suit"|"joker"|"handsBySeat"|"drawPile"|"discardPile"|"publicMelds"|"cards"/);
      // Only the expected public keys appear.
      expect(json).toContain('finalPenalty');
      expect(json).toContain('isWinner');
    }
  });
});

describe('computeFiftyOneStatDeltas', () => {
  it('emits per-player win/loss + penalty/eliminated/rounds (one per seat)', () => {
    const deltas = computeFiftyOneStatDeltas(summarizeFinishedFiftyOneGame(finished()));
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-1']).toMatchObject({ won: true, lost: false, finalPenalty: 210, eliminated: false, roundsPlayed: 9 });
    expect(byId['player-0']).toMatchObject({ won: false, lost: true, finalPenalty: 530, eliminated: true, roundsPlayed: 9 });
    expect(byId['player-2']).toMatchObject({ won: false, lost: true, finalPenalty: 512, eliminated: true });
    // Exactly one winner across the seats.
    expect(deltas.filter((d) => d.won)).toHaveLength(1);
  });
});

describe('Stage 37.3 telemetry — summarizer reads state.telemetry (null-safe)', () => {
  it('a legacy finished state with NO telemetry yields all-false (backward-compatible)', () => {
    const deltas = computeFiftyOneStatDeltas(summarizeFinishedFiftyOneGame(finished())); // no telemetry
    for (const d of deltas) {
      expect(d).toMatchObject({ instantRoundWin: false, neverOpenedGame: false, twoJokerDeal: false, noHundredGame: false });
    }
  });

  it('maps per-seat telemetry booleans; noHundredGame = never took the flat-100', () => {
    const s = finished({
      telemetry: {
        neverOpenedGameBySeat: [true, false, false],
        tookHundredBySeat: [true, false, false],
        twoJokerDealBySeat: [false, false, true],
        instantRoundWinBySeat: [false, true, false],
      },
    });
    const byId = Object.fromEntries(computeFiftyOneStatDeltas(summarizeFinishedFiftyOneGame(s)).map((d) => [d.playerId, d]));
    expect(byId['player-0']).toMatchObject({ neverOpenedGame: true, noHundredGame: false /* took a 100 */ });
    expect(byId['player-1']).toMatchObject({ instantRoundWin: true, neverOpenedGame: false, noHundredGame: true });
    expect(byId['player-2']).toMatchObject({ twoJokerDeal: true, noHundredGame: true });
    // The telemetry booleans never leak any card data.
    expect(JSON.stringify(summarizeFinishedFiftyOneGame(s))).not.toMatch(/"rank"|"suit"|"joker"/);
  });

  it('FAIL 2: a LEGACY match (no telemetry) driven to finish grants NEITHER absence badge', () => {
    // A pre-37.3 game restored mid-match: unknown history. Even if the winner plays a
    // clean final round, `neverOpenedGame` / `noHundredGame` must NOT unlock.
    const legacy: FiftyOneState = {
      gameType: 'fifty-one', phase: 'playing', playerCount: 3,
      players: [P(0), P(1), P(2)],
      dealerSeat: 2, starterSeat: 0, currentSeat: 0, turnStep: 'meld_discard',
      handsBySeat: [[card('7', 'hearts')], [card('8', 'spades')], [card('9', 'clubs')]],
      drawPile: [], discardPile: [],
      openedBySeat: [false, false, false], publicMelds: [],
      scoresBySeat: [0, 500, 500], eliminatedSeats: [false, false, false],
      roundNumber: 7, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
      options: { targetPenalty: 510 },
      // NB: no `telemetry`, no `turnHasPassed` — a legacy persisted state.
    };
    const finishedState = fiftyOneReducer(legacy, { type: 'DISCARD', card: card('7', 'hearts') }) as FiftyOneState;
    expect(finishedState.phase).toBe('game_finished');
    expect(finishedState.winnerSeat).toBe(0);

    const byId = Object.fromEntries(
      computeFiftyOneStatDeltas(summarizeFinishedFiftyOneGame(finishedState)).map((d) => [d.playerId, d]),
    );
    // Winner earns the win, but NOT the two whole-game absence badges (history unknown).
    expect(byId['player-0']).toMatchObject({ won: true, neverOpenedGame: false, noHundredGame: false });
  });
});

describe('fiftyOneFinishSignature', () => {
  it('is stable for the same outcome and differs for a different winner/penalties', () => {
    const a = fiftyOneFinishSignature(finished());
    expect(a).toBe(fiftyOneFinishSignature(finished()));
    expect(fiftyOneFinishSignature(finished({ winnerSeat: 0, eliminatedSeats: [false, true, true] }))).not.toBe(a);
    expect(fiftyOneFinishSignature(finished({ scoresBySeat: [530, 99, 512] }))).not.toBe(a);
    // The signature itself never embeds card data.
    expect(a).not.toMatch(/rank|suit|joker|hearts|spades/);
    expect(a.startsWith('fifty-one|3|1|')).toBe(true);
  });
});
