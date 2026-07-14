import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { fiftyOneReducer } from './engine';
import { totalDeckSize } from './deck';
import type { Rank, Suit } from '../../models/types';
import type { FiftyOneCard, FiftyOneState } from './types';

const c = (rank: Rank, suit: Suit, d = 0): FiftyOneCard => ({ id: `${d}-${suit}-${rank}`, joker: false, suit, rank });
let jokerN = 0;
const J = (): FiftyOneCard => ({ id: `joker-t${jokerN++}`, joker: true, suit: null, rank: null });

/** A minimal playing state with the given hands (targeted reducer tests). */
function baseState(hands: FiftyOneCard[][], over: Partial<FiftyOneState> = {}): FiftyOneState {
  const playerCount = hands.length;
  return {
    gameType: 'fifty-one',
    phase: 'playing',
    playerCount,
    players: hands.map((_, i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'ai' })),
    dealerSeat: 0,
    starterSeat: 1,
    currentSeat: 0,
    turnStep: 'meld_discard',
    handsBySeat: hands,
    drawPile: [],
    discardPile: [],
    openedBySeat: hands.map(() => false),
    publicMelds: [],
    scoresBySeat: hands.map(() => 0),
    eliminatedSeats: hands.map(() => false),
    roundNumber: 1,
    roundWinnerSeat: null,
    winnerSeat: null,
    lastRound: null,
    options: { targetPenalty: 510 },
    ...over,
  };
}

describe('51 START_GAME (§4)', () => {
  it('deals 14 to the starter, 13 to the rest, starts at meld_discard with an empty discard', () => {
    const s = fiftyOneReducer(null, {
      type: 'START_GAME',
      playerNames: ['A', 'B', 'C'],
      playerTypes: ['ai', 'ai', 'ai'],
      dealerSeat: 0,
    }, { rng: makeRng(1) }) as FiftyOneState;

    expect(s.phase).toBe('playing');
    expect(s.playerCount).toBe(3);
    expect(s.starterSeat).toBe(1); // dealer's clockwise neighbour
    expect(s.currentSeat).toBe(1);
    expect(s.turnStep).toBe('meld_discard'); // starter opens by discarding, no draw
    expect(s.handsBySeat[1]).toHaveLength(14);
    expect(s.handsBySeat[0]).toHaveLength(13);
    expect(s.handsBySeat[2]).toHaveLength(13);
    expect(s.discardPile).toHaveLength(0);
    const all = [...s.handsBySeat.flat(), ...s.drawPile];
    expect(all).toHaveLength(totalDeckSize(3));
    expect(new Set(all.map((x) => x.id)).size).toBe(totalDeckSize(3));
  });

  it('rejects a second START_GAME and a bad name/count mismatch', () => {
    const s = fiftyOneReducer(null, { type: 'START_GAME', playerNames: ['A', 'B'] }, { rng: makeRng(2) }) as FiftyOneState;
    expect(fiftyOneReducer(s, { type: 'START_GAME', playerNames: ['A', 'B'] })).toBe(s);
    // playerCount 4 but only 2 names → null.
    expect(fiftyOneReducer(null, { type: 'START_GAME', playerNames: ['A', 'B'], playerCount: 4 })).toBeNull();
  });
});

describe('51 turn flow (§5)', () => {
  it('the starter cannot draw first (already holds 14)', () => {
    const s = baseState([[c('2', 'clubs')], [c('3', 'clubs')]], { currentSeat: 0, turnStep: 'meld_discard' });
    expect(fiftyOneReducer(s, { type: 'DRAW_FROM_DECK' })).toBe(s); // illegal in meld_discard
  });

  it('a normal turn must draw before discarding', () => {
    const s = baseState([[c('2', 'clubs'), c('5', 'hearts')], [c('3', 'clubs')]], {
      currentSeat: 0,
      turnStep: 'draw',
      drawPile: [c('9', 'spades')],
    });
    // Discard before drawing is illegal.
    expect(fiftyOneReducer(s, { type: 'DISCARD', card: c('2', 'clubs') })).toBe(s);
    // Draw advances to meld_discard and grows the hand.
    const drawn = fiftyOneReducer(s, { type: 'DRAW_FROM_DECK' }) as FiftyOneState;
    expect(drawn.turnStep).toBe('meld_discard');
    expect(drawn.handsBySeat[0]).toHaveLength(3);
    expect(drawn.drawPile).toHaveLength(0);
  });

  it('cannot take the discard before opening; can after opening', () => {
    const notOpened = baseState([[c('2', 'clubs')], [c('3', 'clubs')]], {
      currentSeat: 0,
      turnStep: 'draw',
      discardPile: [c('K', 'hearts')],
      drawPile: [c('9', 'spades')],
    });
    expect(fiftyOneReducer(notOpened, { type: 'TAKE_DISCARD' })).toBe(notOpened);

    const opened = baseState([[c('2', 'clubs')], [c('3', 'clubs')]], {
      currentSeat: 0,
      turnStep: 'draw',
      discardPile: [c('K', 'hearts')],
      openedBySeat: [true, false],
    });
    const took = fiftyOneReducer(opened, { type: 'TAKE_DISCARD' }) as FiftyOneState;
    expect(took.handsBySeat[0].map((x) => x.id)).toContain('0-hearts-K');
    expect(took.discardPile).toHaveLength(0);
    expect(took.turnStep).toBe('meld_discard');
  });

  it('discard passes the turn clockwise and sets the next step to draw', () => {
    const s = baseState([[c('2', 'clubs'), c('5', 'hearts')], [c('3', 'clubs')]], { currentSeat: 0, turnStep: 'meld_discard' });
    const d = fiftyOneReducer(s, { type: 'DISCARD', card: c('2', 'clubs') }) as FiftyOneState;
    expect(d.currentSeat).toBe(1);
    expect(d.turnStep).toBe('draw');
    expect(d.discardPile[d.discardPile.length - 1].id).toBe('0-clubs-2');
    expect(d.handsBySeat[0]).toHaveLength(1);
  });

  it('reshuffles the discard (keeping its top) into an empty draw pile', () => {
    const s = baseState([[c('2', 'clubs')], [c('3', 'clubs')]], {
      currentSeat: 0,
      turnStep: 'draw',
      drawPile: [],
      discardPile: [c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts')],
    });
    const d = fiftyOneReducer(s, { type: 'DRAW_FROM_DECK' }, { rng: makeRng(3) }) as FiftyOneState;
    expect(d.handsBySeat[0]).toHaveLength(2);         // drew one
    expect(d.discardPile).toHaveLength(1);            // only the kept top remains
    expect(d.discardPile[0].id).toBe('0-hearts-6');   // top preserved
    expect(d.drawPile).toHaveLength(1);               // 3 − top − drawn = 1
  });
});

describe('51 opening (§7)', () => {
  const opener = () => [
    c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts'), // run = 30
    c('7', 'clubs'), c('7', 'diamonds'), c('7', 'spades'), // set = 21
    c('2', 'clubs'),                                        // spare (to discard)
  ];

  it('opens with melds totalling exactly 51 and keeps a card to discard', () => {
    const s = baseState([opener(), [c('3', 'clubs')]], { currentSeat: 0 });
    const run = opener().slice(0, 3);
    const set = opener().slice(3, 6);
    const o = fiftyOneReducer(s, { type: 'OPEN_MELDS', melds: [run, set] }) as FiftyOneState;
    expect(o).not.toBe(s);
    expect(o.openedBySeat[0]).toBe(true);
    expect(o.publicMelds).toHaveLength(2);
    expect(o.publicMelds.every((m) => m.ownerSeat === 0)).toBe(true);
    expect(o.handsBySeat[0]).toHaveLength(1);   // only the spare left
    expect(o.turnStep).toBe('meld_discard');    // must still discard
  });

  it('rejects an opening under 51', () => {
    // run 30 + set of four 5s (20) = 50 < 51.
    const hand = [
      c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts'),
      c('5', 'spades'), c('5', 'hearts'), c('5', 'clubs'), c('5', 'diamonds'),
      c('2', 'clubs'),
    ];
    const s = baseState([hand, [c('3', 'clubs')]], { currentSeat: 0 });
    const run = hand.slice(0, 3);
    const set = hand.slice(3, 7);
    expect(fiftyOneReducer(s, { type: 'OPEN_MELDS', melds: [run, set] })).toBe(s);
  });

  it('rejects opening that would empty the hand (no card left to discard)', () => {
    const hand = opener().slice(0, 6); // exactly the two melds, no spare
    const s = baseState([hand, [c('3', 'clubs')]], { currentSeat: 0 });
    const run = hand.slice(0, 3);
    const set = hand.slice(3, 6);
    expect(fiftyOneReducer(s, { type: 'OPEN_MELDS', melds: [run, set] })).toBe(s);
  });

  it('an already-opened seat lays a low-value meld with NO 51 gate (30.9)', () => {
    // Opened seat holds a 15-point run (4-5-6) + a spare; laying it must be accepted
    // even though 15 < 51 (the opening gate applies only to the FIRST lay-down).
    const hand = [c('4', 'spades'), c('5', 'spades'), c('6', 'spades'), c('2', 'clubs')];
    const s = baseState([hand, [c('3', 'clubs')]], { currentSeat: 0, openedBySeat: [true, false] });
    const run = hand.slice(0, 3);
    const o = fiftyOneReducer(s, { type: 'OPEN_MELDS', melds: [run] }) as FiftyOneState;
    expect(o).not.toBe(s);
    expect(o.openedBySeat[0]).toBe(true);           // stays opened
    expect(o.publicMelds).toHaveLength(1);
    expect(o.publicMelds[0].value).toBe(15);        // 4+5+6, below 51 — accepted
    expect(o.handsBySeat[0]).toHaveLength(1);        // spare kept to discard
    expect(o.turnStep).toBe('meld_discard');
  });

  it('an UNOPENED seat still cannot lay a sub-51 meld (opening gate holds)', () => {
    const hand = [c('4', 'spades'), c('5', 'spades'), c('6', 'spades'), c('2', 'clubs')];
    const s = baseState([hand, [c('3', 'clubs')]], { currentSeat: 0 }); // openedBySeat[0] = false
    const run = hand.slice(0, 3);
    expect(fiftyOneReducer(s, { type: 'OPEN_MELDS', melds: [run] })).toBe(s); // 15 < 51 → rejected
  });
});

describe('51 lay-off (§9)', () => {
  it('adds a fitting card to a public meld only after opening', () => {
    const meld = {
      id: 'm-1-1-0',
      ownerSeat: 1,
      type: 'run' as const,
      cards: [c('5', 'spades'), c('6', 'spades'), c('7', 'spades')],
      jokerRepresents: {},
      value: 18,
    };
    const hand = [c('8', 'spades'), c('2', 'clubs')];
    // Not opened → illegal.
    const notOpened = baseState([hand, []], { currentSeat: 0, publicMelds: [meld] });
    expect(fiftyOneReducer(notOpened, { type: 'ADD_TO_MELD', meldId: 'm-1-1-0', cards: [c('8', 'spades')] })).toBe(notOpened);

    // Opened → 8♠ extends the run to 5-6-7-8.
    const opened = baseState([hand, []], { currentSeat: 0, openedBySeat: [true, false], publicMelds: [meld] });
    const added = fiftyOneReducer(opened, { type: 'ADD_TO_MELD', meldId: 'm-1-1-0', cards: [c('8', 'spades')] }) as FiftyOneState;
    expect(added.publicMelds[0].cards).toHaveLength(4);
    expect(added.publicMelds[0].value).toBe(26);
    expect(added.handsBySeat[0]).toHaveLength(1);
  });

  it('rejects a lay-off that breaks the meld', () => {
    const meld = {
      id: 'm-1-1-0', ownerSeat: 1, type: 'run' as const,
      cards: [c('5', 'spades'), c('6', 'spades'), c('7', 'spades')], jokerRepresents: {}, value: 18,
    };
    const s = baseState([[c('K', 'hearts'), c('2', 'clubs')], []], { currentSeat: 0, openedBySeat: [true, false], publicMelds: [meld] });
    expect(fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm-1-1-0', cards: [c('K', 'hearts')] })).toBe(s);
  });

  it('lays an Ace onto a public 2-3-4 run → A-2-3-4, displayed Ace-first (30.10)', () => {
    const meld = {
      id: 'm-1-1-0', ownerSeat: 1, type: 'run' as const,
      cards: [c('2', 'spades'), c('3', 'spades'), c('4', 'spades')], jokerRepresents: {}, value: 9,
    };
    const hand = [c('A', 'spades'), c('2', 'clubs')];
    // Unopened → still illegal (lay-off is open-gated, §9).
    const notOpened = baseState([hand, []], { currentSeat: 0, publicMelds: [meld] });
    expect(fiftyOneReducer(notOpened, { type: 'ADD_TO_MELD', meldId: 'm-1-1-0', cards: [c('A', 'spades')] })).toBe(notOpened);

    // Opened → the Ace extends the low end; the meld re-resolves to A-2-3-4.
    const opened = baseState([hand, []], { currentSeat: 0, openedBySeat: [true, false], publicMelds: [meld] });
    const added = fiftyOneReducer(opened, { type: 'ADD_TO_MELD', meldId: 'm-1-1-0', cards: [c('A', 'spades')] }) as FiftyOneState;
    expect(added.publicMelds[0].cards.map((x) => x.rank)).toEqual(['A', '2', '3', '4']); // Ace-first
    expect(added.publicMelds[0].value).toBe(10); // 1+2+3+4
    expect(added.handsBySeat[0]).toHaveLength(1);
  });

  it('rejects laying a King onto a public A-2-3 run (A-2-3-K is not a run)', () => {
    const meld = {
      id: 'm-1-1-0', ownerSeat: 1, type: 'run' as const,
      cards: [c('A', 'spades'), c('2', 'spades'), c('3', 'spades')], jokerRepresents: {}, value: 6,
    };
    const s = baseState([[c('K', 'spades'), c('2', 'clubs')], []], { currentSeat: 0, openedBySeat: [true, false], publicMelds: [meld] });
    expect(fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm-1-1-0', cards: [c('K', 'spades')] })).toBe(s);
  });

  it('lays a joker meld in the chosen position, keeps one card, and wins by final discard (30.12)', () => {
    // Opened seat holds 7♠ [joker] 9♠ (a run with the joker as the middle 8♠) + a spare.
    const joker = J();
    const hand = [c('7', 'spades'), joker, c('9', 'spades'), c('2', 'clubs')];
    const s = baseState([hand, [c('3', 'clubs')]], { currentSeat: 0, openedBySeat: [true, false] });
    // Lay the joker run in the tapped order [7, joker, 9] → 7-8-9, joker represents 8♠.
    const laid = fiftyOneReducer(s, { type: 'OPEN_MELDS', melds: [[c('7', 'spades'), joker, c('9', 'spades')]] }) as FiftyOneState;
    expect(laid).not.toBe(s);
    expect(laid.publicMelds).toHaveLength(1);
    expect(laid.publicMelds[0].jokerRepresents[1]).toEqual({ suit: 'spades', rank: '8' });
    expect(laid.handsBySeat[0]).toHaveLength(1); // only the spare 2♣ kept
    expect(laid.turnStep).toBe('meld_discard');  // must still discard to go out
    // Discarding the last card empties the hand → round win by final discard.
    const done = fiftyOneReducer(laid, { type: 'DISCARD', card: c('2', 'clubs') }) as FiftyOneState;
    expect(done.roundWinnerSeat).toBe(0);
  });
});
