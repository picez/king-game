import { describe, it, expect } from 'vitest';
import { aiChooseCard, aiChooseTrump, aiChooseMode, aiChooseKittyDiscards } from './ai';
import { gameReducer, getCurrentPlayer } from './gameEngine';
import { getValidCards, cardEquals } from './rules';
import { getValidKittyDiscards } from './kitty';
import { makeRng } from './rng';
import type { Card, GameModeId, GameState, ModeCounts, Suit } from '../models/types';

// ── Small builders ──────────────────────────────────────────────────────────
const card = (suit: Suit, rank: string, value: number): Card => ({ suit, rank: rank as Card['rank'], value });
const ALL_MODES: GameModeId[] = ['no_tricks', 'no_hearts', 'no_queens', 'no_jacks', 'king_of_hearts', 'last_two_tricks', 'trump'];
const zeroCounts = (): ModeCounts =>
  ALL_MODES.reduce((acc, m) => { acc[m] = 0; return acc; }, {} as ModeCounts);

function start(names: string[], modeSelectionType: 'fixed' | 'dealer_choice' = 'fixed', seed = 1): GameState {
  // Seeded rng → deterministic, reproducible deals (no flaky runs).
  const s = gameReducer(
    null,
    { type: 'START_GAME', playerNames: names, playerTypes: names.map(() => 'human'), modeSelectionType },
    { rng: makeRng(seed) },
  );
  if (!s) throw new Error('START_GAME returned null');
  return s;
}

/**
 * Drive a whole round where EVERY decision is made by the AI. Asserts that each
 * aiChooseCard result is a LEGAL card (the exact concern from the release audit:
 * the turn-timer auto-play flows straight through the authoritative reducer, so
 * an illegal/crashing move would be a real bug). Returns the terminal state.
 */
function playRoundWithAI(state: GameState, forcedMode?: GameModeId): GameState {
  let s = state;
  for (let guard = 0; guard < 400; guard++) {
    switch (s.status) {
      case 'mode_selection': {
        const dealer = getCurrentPlayer(s);
        const modeId = forcedMode ?? aiChooseMode(s.dealerModes[dealer.id]);
        s = gameReducer(s, { type: 'CHOOSE_MODE', modeId })!;
        break;
      }
      case 'select_trump': {
        const dealer = getCurrentPlayer(s);
        const suit = aiChooseTrump(dealer.hand) ?? dealer.hand[0].suit;
        s = gameReducer(s, { type: 'SELECT_TRUMP', suit })!;
        break;
      }
      case 'kitty_exchange': {
        // The dealer discards from their FULL hand (kitty already merged in by
        // takeKitty), exactly as botAction does — NOT from kittyForExchange.
        const dealer = s.players[s.dealerIndex];
        const discards = aiChooseKittyDiscards(dealer.hand, s.config.kittySize, s.currentRound.mode.id);
        s = gameReducer(s, { type: 'EXCHANGE_KITTY', discards })!;
        break;
      }
      case 'trick_complete':
        s = gameReducer(s, { type: 'NEXT_TRICK' })!;
        break;
      case 'playing': {
        const p = getCurrentPlayer(s);
        const ledSuit = s.currentTrick?.ledSuit ?? null;
        const valid = getValidCards(p.hand, ledSuit, s.currentRound.mode.id, s.trumpSuit);
        const chosen = aiChooseCard(s);
        // The core invariant under test: the AI never returns an illegal card.
        expect(valid.some((v) => cardEquals(v, chosen)), `illegal AI card in ${s.currentRound.mode.id}`).toBe(true);
        s = gameReducer(s, { type: 'PLAY_CARD', playerId: p.id, card: chosen })!;
        break;
      }
      default:
        return s; // round_scoring / game_finished
    }
    if (s.status === 'round_scoring' || s.status === 'game_finished') return s;
  }
  throw new Error(`round did not finish (stuck at ${s.status})`);
}

describe('aiChooseCard — always legal, completes every mode', () => {
  for (const mode of ALL_MODES) {
    it(`3-player Dealer's Choice round in ${mode} finishes with only legal AI plays`, () => {
      const done = playRoundWithAI(start(['A', 'B', 'C'], 'dealer_choice'), mode);
      expect(['round_scoring', 'game_finished']).toContain(done.status);
    });
  }

  it('4-player fixed game plays a full round with legal AI cards', () => {
    const done = playRoundWithAI(start(['A', 'B', 'C', 'D'], 'fixed'));
    expect(['round_scoring', 'game_finished']).toContain(done.status);
  });
});

describe('aiChooseTrump', () => {
  it('picks the longest suit', () => {
    const hand = [
      card('spades', 'A', 14), card('spades', 'K', 13), card('spades', '7', 7),
      card('hearts', 'Q', 12), card('clubs', '8', 8),
    ];
    expect(aiChooseTrump(hand)).toBe('spades');
  });

  it('breaks a length tie by high-card strength', () => {
    const hand = [
      card('spades', 'A', 14), card('spades', 'K', 13), card('spades', 'Q', 12), // strong 3
      card('clubs', '9', 9), card('clubs', '8', 8), card('clubs', '7', 7),        // weak 3
    ];
    expect(aiChooseTrump(hand)).toBe('spades');
  });

  it('returns null when no suit reaches 3 cards', () => {
    const hand = [
      card('spades', 'A', 14), card('spades', 'K', 13),
      card('hearts', 'Q', 12), card('hearts', 'J', 11),
      card('clubs', '9', 9), card('diamonds', '8', 8),
    ];
    expect(aiChooseTrump(hand)).toBeNull();
  });
});

describe('aiChooseMode', () => {
  it('prefers Trump while any copies remain', () => {
    const counts = zeroCounts();
    counts.trump = 2; counts.no_hearts = 1;
    expect(aiChooseMode(counts)).toBe('trump');
  });

  it('falls to the first remaining negative mode in canonical order', () => {
    const counts = zeroCounts();
    counts.no_hearts = 1; counts.no_queens = 1; // no_tricks is 0 → skipped
    expect(aiChooseMode(counts)).toBe('no_hearts');
  });

  it('falls back to trump when nothing remains (defensive)', () => {
    expect(aiChooseMode(zeroCounts())).toBe('trump');
  });
});

describe('aiChooseKittyDiscards', () => {
  const hand = [
    card('spades', 'A', 14), card('spades', '7', 7),
    card('hearts', 'K', 13), card('hearts', '8', 8),
    card('clubs', '9', 9), card('diamonds', '6', 6),
  ];

  it('discards exactly kittySize legal cards', () => {
    const d = aiChooseKittyDiscards(hand, 2, 'trump');
    expect(d).toHaveLength(2);
    const legal = getValidKittyDiscards(hand, 'trump');
    for (const c of d) expect(legal.some((l) => cardEquals(l, c))).toBe(true);
  });

  it('Trump: keeps high cards → discards the lowest legal', () => {
    const d = aiChooseKittyDiscards(hand, 2, 'trump');
    // 6 and 7 are the two lowest.
    expect(d.map((c) => c.value).sort((a, b) => a - b)).toEqual([6, 7]);
  });

  it('negative mode: sheds high cards → discards the highest legal', () => {
    const d = aiChooseKittyDiscards(hand, 2, 'no_tricks');
    // Highest two are A(14) and K(13); both are legal in no_tricks (no per-card penalty guard there).
    expect(d.map((c) => c.value).sort((a, b) => b - a)).toEqual([14, 13]);
  });

  it('never discards the mode penalty card (King of Hearts)', () => {
    const d = aiChooseKittyDiscards(hand, 2, 'king_of_hearts');
    expect(d.some((c) => c.suit === 'hearts' && c.rank === 'K')).toBe(false);
  });
});
