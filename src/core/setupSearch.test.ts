import { describe, it, expect } from 'vitest';
import { chooseTrumpLookahead, chooseKittyDiscardsLookahead } from './setupSearch';
import { aiChooseCard, aiChooseMode } from './ai';
import { gameReducer, getCurrentPlayer } from './gameEngine';
import { getValidKittyDiscards } from './kitty';
import { cardEquals } from './rules';
import { makeRng } from './rng';
import type { GameState, Suit } from '../models/types';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

function start(names: string[], seed: number): GameState {
  const s = gameReducer(
    null,
    { type: 'START_GAME', playerNames: names, playerTypes: names.map(() => 'ai'), modeSelectionType: 'fixed' },
    { rng: makeRng(seed) },
  );
  if (!s) throw new Error('START_GAME returned null');
  return s;
}

/**
 * Drive rounds, invoking the setup-search choosers on every select_trump /
 * kitty_exchange screen (and advancing with their result), so the invariants are
 * checked on real, reachable setup states. Returns how many of each we saw.
 */
function driveSetup(
  seed: number,
  onTrump: (s: GameState) => void,
  onKitty: (s: GameState) => void,
): void {
  let s = start(['A', 'B', 'C'], seed);
  for (let guard = 0; guard < 4000; guard++) {
    switch (s.status) {
      case 'game_finished': return;
      case 'mode_selection':
        s = gameReducer(s, { type: 'CHOOSE_MODE', modeId: aiChooseMode(s.dealerModes[getCurrentPlayer(s).id]) })!;
        break;
      case 'select_trump': {
        onTrump(s);
        s = gameReducer(s, { type: 'SELECT_TRUMP', suit: chooseTrumpLookahead(s) })!;
        break;
      }
      case 'kitty_exchange': {
        onKitty(s);
        s = gameReducer(s, { type: 'EXCHANGE_KITTY', discards: chooseKittyDiscardsLookahead(s) })!;
        break;
      }
      case 'trick_complete':
        s = gameReducer(s, { type: 'NEXT_TRICK' })!;
        break;
      case 'round_scoring':
        s = gameReducer(s, { type: 'NEXT_ROUND' }, { rng: makeRng(seed + guard) })!;
        break;
      case 'playing': {
        const p = getCurrentPlayer(s);
        s = gameReducer(s, { type: 'PLAY_CARD', playerId: p.id, card: aiChooseCard(s) })!;
        break;
      }
      default:
        throw new Error(`unexpected ${s.status}`);
    }
  }
  throw new Error('did not finish');
}

describe('setupSearch — trump choice', () => {
  it('returns a legal suit and is deterministic on every select_trump state', () => {
    let seen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      driveSetup(seed, (s) => {
        const suit = chooseTrumpLookahead(s);
        expect(suit == null || SUITS.includes(suit)).toBe(true);
        expect(chooseTrumpLookahead(s)).toBe(suit); // deterministic
        seen++;
      }, () => { /* kitty checked elsewhere */ });
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('setupSearch — kitty discards', () => {
  it('discards exactly kittySize legal cards, never a penalty, deterministically', () => {
    let seen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      driveSetup(seed, () => { /* trump checked elsewhere */ }, (s) => {
        const dealer = s.players[s.dealerIndex];
        const modeId = s.currentRound.mode.id;
        const legal = getValidKittyDiscards(dealer.hand, modeId);
        const d = chooseKittyDiscardsLookahead(s);

        expect(d).toHaveLength(s.config.kittySize);
        for (const c of d) {
          expect(legal.some((l) => cardEquals(l, c)), `illegal discard in ${modeId}`).toBe(true);
          expect(dealer.hand.some((h) => cardEquals(h, c))).toBe(true); // from the dealer's hand
        }
        // Deterministic: same state → same discards.
        const again = chooseKittyDiscardsLookahead(s);
        expect(again.map((c) => `${c.suit}${c.rank}`).sort()).toEqual(d.map((c) => `${c.suit}${c.rank}`).sort());
        seen++;
      });
    }
    expect(seen).toBeGreaterThan(0);
  });
});
