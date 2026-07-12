// Deberc trump exchange (Stage 27.2, §6a). The current declarer may swap its lowest trump
// (7 for 3p, 6 for 4p) for the face-up table trump, before it declares. Card total preserved.
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debercReducer } from './engine';
import { debercBotAction } from './ai';
import { canExchangeTrump, lowTrumpRank, cardEquals } from './rules';
import { debercRedactStateFor } from './redact';
import { seqValue } from './deck';
import type { Card, Rank, Suit } from '../../models/types';
import type { DebercState } from './types';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: seqValue(rank) });
const has = (hand: Card[], c: Card) => hand.some((x) => cardEquals(x, c));

/** Drive a fresh N-player Deberc to the declaring phase (the first bidder takes the table trump). */
function declaring(n: 3 | 4, seed = 1): DebercState {
  const names = ['A', 'B', 'C', 'D'].slice(0, n);
  const s0 = debercReducer(null, { type: 'START_DEBERC', playerNames: names, playerTypes: names.map(() => 'human'), matchSize: 'small' }, { rng: makeRng(seed) })!;
  const s1 = debercReducer(s0, { type: 'BID', suit: s0.tableTrumpCard.suit })!; // commit the table trump
  expect(s1.phase).toBe('declaring');
  return s1;
}

/** Move the (unique) `want` card in the deal into `toList[toIdx]` by SWAPPING — preserves the
 *  36-card multiset (no duplicates), unlike overwriting a slot. */
function swapInto(st: DebercState, want: Card, toList: Card[], toIdx: number): void {
  for (const list of [...st.players.map((p) => p.hand), st.stock]) {
    const i = list.findIndex((c) => cardEquals(c, want));
    if (i < 0) continue;
    if (list === toList && i === toIdx) return;
    const tmp = toList[toIdx]; toList[toIdx] = list[i]; list[i] = tmp; return;
  }
}

/** A controlled exchange scenario: the acting declarer holds `low`, and `exposed` (a higher trump)
 *  is the table trump — in the stock (3p) or the dealer's hand (4p). Multiset stays a real deal. */
function withScenario(s: DebercState): { state: DebercState; seat: number; trump: Suit; low: Card; exposed: Card } {
  const seat = s.meldTurnSeat;
  const trump = s.trumpSuit as Suit;
  const low = card(trump, lowTrumpRank(s.players.length));
  const exposed = card(trump, 'A');
  const st: DebercState = JSON.parse(JSON.stringify(s));
  swapInto(st, low, st.players[seat].hand, 0);
  if (st.players.length === 3) swapInto(st, exposed, st.stock, 0);
  else swapInto(st, exposed, st.players[st.dealerSeat].hand, 0);
  st.tableTrumpCard = { ...exposed };
  // Re-snapshot dealtHands from the (now-arranged) hands — valid since no card has been played.
  st.dealtHands = st.players.map((p) => p.hand.map((c) => ({ ...c })));
  return { state: st, seat, trump, low, exposed };
}

describe('canExchangeTrump — eligibility', () => {
  it('3p: the declarer holding the 7 of trump is eligible', () => {
    const { state, seat } = withScenario(declaring(3));
    expect(canExchangeTrump(state, seat)).toBe(true);
  });
  it('4p: the declarer holding the 6 of trump is eligible', () => {
    const { state, seat } = withScenario(declaring(4));
    expect(canExchangeTrump(state, seat)).toBe(true);
    expect(lowTrumpRank(4)).toBe('6');
  });
  it('ineligible: no low trump, wrong phase, already exchanged, or not the declarer', () => {
    const { state, seat } = withScenario(declaring(3));
    expect(canExchangeTrump({ ...state, players: state.players.map((p, i) => i === seat ? { ...p, hand: p.hand.filter((c) => c.rank !== '7') } : p) }, seat)).toBe(false); // no 7
    expect(canExchangeTrump({ ...state, phase: 'playing' }, seat)).toBe(false);                 // play started
    expect(canExchangeTrump({ ...state, trumpExchanged: true }, seat)).toBe(false);              // once per hand
    expect(canExchangeTrump(state, (seat + 1) % state.players.length)).toBe(false);              // not the declarer's turn
  });
});

describe('EXCHANGE_TRUMP — apply (3p)', () => {
  it('swaps the low trump for the exposed one, preserves the hand count, updates the table trump', () => {
    const { state, seat, low, exposed } = withScenario(declaring(3));
    const before = state.players[seat].hand.length;
    const next = debercReducer(state, { type: 'EXCHANGE_TRUMP' })!;
    expect(next).not.toBe(state);
    expect(has(next.players[seat].hand, exposed)).toBe(true);    // took the exposed trump
    expect(has(next.players[seat].hand, low)).toBe(false);       // gave up the low trump
    expect(next.players[seat].hand.length).toBe(before);         // count preserved
    expect(cardEquals(next.tableTrumpCard, low)).toBe(true);     // low is now the table trump
    expect(has(next.stock, low)).toBe(true);                     // the low trump moved into the stock
    expect(has(next.stock, exposed)).toBe(false);
    expect(next.trumpExchanged).toBe(true);
    expect(next.trumpExchangedBy).toBe(seat);
    // dealtHands (meld snapshot) stays consistent with the live hand.
    expect(has(next.dealtHands[seat], exposed)).toBe(true);
  });

  it('a SECOND exchange in the same hand is rejected (same ref)', () => {
    const { state } = withScenario(declaring(3));
    const once = debercReducer(state, { type: 'EXCHANGE_TRUMP' })!;
    expect(debercReducer(once, { type: 'EXCHANGE_TRUMP' })).toBe(once);
  });

  it('rejected once play has started, or with no low trump (same ref)', () => {
    const { state, seat } = withScenario(declaring(3));
    expect(debercReducer({ ...state, phase: 'playing' }, { type: 'EXCHANGE_TRUMP' })).toEqual({ ...state, phase: 'playing' });
    const noLow = { ...state, players: state.players.map((p, i) => i === seat ? { ...p, hand: p.hand.filter((c) => c.rank !== '7') } : p) };
    expect(debercReducer(noLow, { type: 'EXCHANGE_TRUMP' })).toBe(noLow);
  });

  it('scoring/trick fields are untouched by the swap', () => {
    const { state } = withScenario(declaring(3));
    const next = debercReducer(state, { type: 'EXCHANGE_TRUMP' })!;
    expect(next.tricksPlayed).toBe(state.tricksPlayed);
    expect(next.wonCards).toEqual(state.wonCards);
    expect(next.matchScore).toEqual(state.matchScore);
    expect(next.trumpSuit).toBe(state.trumpSuit);
  });
});

describe('EXCHANGE_TRUMP — apply (4p)', () => {
  it('takes the exposed trump from the dealer\'s hand; both hands keep 9 cards', () => {
    const { state, seat, low, exposed } = withScenario(declaring(4));
    const dealer = state.dealerSeat;
    const next = debercReducer(state, { type: 'EXCHANGE_TRUMP' })!;
    expect(next).not.toBe(state);
    expect(has(next.players[seat].hand, exposed)).toBe(true);
    expect(has(next.players[dealer].hand, low)).toBe(true);       // dealer received the low trump
    expect(has(next.players[dealer].hand, exposed)).toBe(false);
    expect(next.players[seat].hand.length).toBe(state.players[seat].hand.length);
    expect(next.players[dealer].hand.length).toBe(state.players[dealer].hand.length);
    expect(cardEquals(next.tableTrumpCard, low)).toBe(true);
  });
});

describe('bot exchanges when eligible', () => {
  it('a bot declarer with the low trump chooses EXCHANGE_TRUMP before declaring', () => {
    const { state } = withScenario(declaring(3));
    expect(debercBotAction(state)).toEqual({ type: 'EXCHANGE_TRUMP' });
    // After the swap it no longer offers the exchange (once per hand).
    const next = debercReducer(state, { type: 'EXCHANGE_TRUMP' })!;
    expect(debercBotAction(next)).not.toEqual({ type: 'EXCHANGE_TRUMP' });
  });
});

describe('redaction — the exchange leaks no hidden hand (only the public swap)', () => {
  it('an opponent sees the new public table trump + the exchange flag, but not the swapper\'s hand', () => {
    const { state, seat, exposed } = withScenario(declaring(3));
    const next = debercReducer(state, { type: 'EXCHANGE_TRUMP' })!;
    const opponent = (seat + 1) % next.players.length;
    const view = debercRedactStateFor(next, opponent);
    // Public: the new table trump (the low card) + the exchange flag are visible.
    expect(view.trumpExchanged).toBe(true);
    expect(view.trumpExchangedBy).toBe(seat);
    // Private: the swapper's hand is hidden (face-down placeholders), so the taken exposed card
    // is NOT revealed among their real cards; the stock (holding the low trump) is hidden too.
    expect(view.players[seat].hand.every((c) => (c.rank as string) === '?')).toBe(true);
    expect(view.players[seat].hand.some((c) => cardEquals(c, exposed))).toBe(false);
    expect(view.stock.every((c) => (c.rank as string) === '?')).toBe(true);
  });
});

describe('UI + i18n wiring (source guards)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
  it('DebercGameScreen shows the exchange button only when eligible + a public note', () => {
    const ui = read('src/ui/deberc/DebercGameScreen.tsx');
    expect(ui).toContain('canExchangeTrump');
    expect(ui).toMatch(/canExchange &&[\s\S]*EXCHANGE_TRUMP/);
    expect(ui).toContain("t('deberc.exchangeTrump')");
    expect(ui).toMatch(/trumpExchanged &&[\s\S]*exchangedLowTrump/);
  });
  it('i18n keys exist in all four languages', () => {
    for (const lang of ['en', 'uk', 'de', 'ar']) {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      expect(dict, lang).toContain("'deberc.exchangeTrump'");
      expect(dict, lang).toContain("'deberc.exchangedLowTrump'");
    }
  });
});
