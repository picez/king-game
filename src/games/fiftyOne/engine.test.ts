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

describe('51 discard-to-open (§5/§7, owner rule 30.13)', () => {
  const top = c('7', 'spades');                                        // the discard top
  const setPart = [c('7', 'clubs'), c('7', 'diamonds')];               // + top = set of 7s (21)
  const run = [c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts')]; // 30
  const spare = c('2', 'clubs');
  const baseHand = [...setPart, ...run, spare]; // hand does NOT hold the top
  const draw = (over: Partial<FiftyOneState> = {}) =>
    baseState([baseHand, [c('3', 'clubs')]], {
      currentSeat: 0, turnStep: 'draw', discardPile: [top], drawPile: [c('9', 'spades')], ...over,
    });

  it('an unopened seat cannot take the discard into hand (plain TAKE_DISCARD rejected)', () => {
    const s = draw();
    expect(fiftyOneReducer(s, { type: 'TAKE_DISCARD' })).toBe(s);
  });

  it('an unopened seat takes the discard AND opens with it (top in melds, total ≥ 51)', () => {
    const s = draw();
    const melds = [[top, ...setPart], run]; // set of 7s (incl. the top) + heart run = 51
    const o = fiftyOneReducer(s, { type: 'TAKE_DISCARD_AND_OPEN', melds }) as FiftyOneState;
    expect(o).not.toBe(s);
    expect(o.openedBySeat[0]).toBe(true);
    expect(o.discardPile).toHaveLength(0);          // the top was taken out
    expect(o.publicMelds).toHaveLength(2);
    expect(o.publicMelds.reduce((n, m) => n + m.value, 0)).toBe(51);
    expect(o.handsBySeat[0].map((x) => x.id)).toEqual([spare.id]); // only the spare kept
    expect(o.turnStep).toBe('meld_discard');        // must still discard
    // Discarding the last card empties the hand → round win by final discard.
    const done = fiftyOneReducer(o, { type: 'DISCARD', card: spare }) as FiftyOneState;
    expect(done.roundWinnerSeat).toBe(0);
  });

  it('rejects take-and-open when the discard top is NOT part of the opening melds', () => {
    // A ≥51 opening exists in-hand (30 run + 24 set) that ignores the top → must be
    // rejected, since taking the discard is only allowed to open WITH that card.
    const hand = [
      c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts'),   // 30
      c('8', 'clubs'), c('8', 'diamonds'), c('8', 'spades'),   // 24
      c('2', 'clubs'),
    ];
    const s = baseState([hand, [c('3', 'clubs')]], {
      currentSeat: 0, turnStep: 'draw', discardPile: [c('7', 'spades')], drawPile: [c('9', 'spades')],
    });
    const melds = [hand.slice(0, 3), hand.slice(3, 6)]; // no top
    expect(fiftyOneReducer(s, { type: 'TAKE_DISCARD_AND_OPEN', melds })).toBe(s);
  });

  it('rejects take-and-open when the opening total is under 51 (even using the top)', () => {
    // top 4♠ + 5♠ 6♠ = a 4-5-6 run worth 15 < 51.
    const hand = [c('5', 'spades'), c('6', 'spades'), c('2', 'clubs')];
    const s = baseState([hand, [c('3', 'clubs')]], {
      currentSeat: 0, turnStep: 'draw', discardPile: [c('4', 'spades')], drawPile: [c('9', 'spades')],
    });
    expect(fiftyOneReducer(s, { type: 'TAKE_DISCARD_AND_OPEN', melds: [[c('4', 'spades'), c('5', 'spades'), c('6', 'spades')]] })).toBe(s);
  });

  it('an OPENED seat still takes the discard normally; take-and-open is rejected for it', () => {
    const s = draw({ openedBySeat: [true, false] });
    const took = fiftyOneReducer(s, { type: 'TAKE_DISCARD' }) as FiftyOneState;
    expect(took.handsBySeat[0].map((x) => x.id)).toContain(top.id); // taken into hand
    expect(took.turnStep).toBe('meld_discard');
    // The atomic take-and-open is only for UNOPENED seats.
    expect(fiftyOneReducer(s, { type: 'TAKE_DISCARD_AND_OPEN', melds: [[top, ...setPart], run] })).toBe(s);
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

describe('51 joker replacement (§9a, owner rule 30.14)', () => {
  /** A public set J♣ J♦ [joker=J♥] owned by seat 1 — the canonical example. */
  const jokerSet = (joker: FiftyOneCard) => ({
    id: 'm-1-1-0',
    ownerSeat: 1,
    type: 'set' as const,
    cards: [c('J', 'clubs'), c('J', 'diamonds'), joker],
    jokerRepresents: { 2: { suit: 'hearts' as Suit, rank: 'J' as Rank } },
    value: 30,
  });

  it('an opened player swaps J♥ for the joker representing J♥ and takes it into hand', () => {
    const joker = J();
    const s = baseState([[c('J', 'hearts'), c('2', 'clubs')], []], {
      currentSeat: 0, openedBySeat: [true, false], publicMelds: [jokerSet(joker)],
    });
    const r = fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('J', 'hearts') }) as FiftyOneState;
    expect(r).not.toBe(s);
    // The meld now holds the REAL J♥ at the joker's slot, with no joker left in it.
    expect(r.publicMelds[0].cards.map((x) => x.id)).toEqual(['0-clubs-J', '0-diamonds-J', '0-hearts-J']);
    expect(r.publicMelds[0].cards.some((x) => x.joker)).toBe(false);
    expect(r.publicMelds[0].jokerRepresents).toEqual({});
    expect(r.publicMelds[0].value).toBe(30); // unchanged — the swap is value-neutral
    // The joker is now in the player's hand (worth 25 there, §11), and the 2♣ remains.
    expect(r.handsBySeat[0].map((x) => x.id).sort()).toEqual([joker.id, '0-clubs-2'].sort());
    expect(r.turnStep).toBe('meld_discard'); // the turn still ends on a discard (§5)
  });

  it('swaps the 9 for a joker representing 9♠ inside a run 7-8-[joker]', () => {
    const joker = J();
    const meld = {
      id: 'm-1-1-0', ownerSeat: 1, type: 'run' as const,
      cards: [c('7', 'spades'), c('8', 'spades'), joker],
      jokerRepresents: { 2: { suit: 'spades' as Suit, rank: '9' as Rank } }, value: 24,
    };
    const s = baseState([[c('9', 'spades'), c('2', 'clubs')], []], {
      currentSeat: 0, openedBySeat: [true, false], publicMelds: [meld],
    });
    const r = fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('9', 'spades') }) as FiftyOneState;
    expect(r.publicMelds[0].cards.map((x) => x.rank)).toEqual(['7', '8', '9']);
    expect(r.publicMelds[0].value).toBe(24);
    expect(r.handsBySeat[0].filter((x) => x.joker)).toHaveLength(1);
  });

  it('rejects an unopened player — they may never take a joker off the table', () => {
    const joker = J();
    const s = baseState([[c('J', 'hearts'), c('2', 'clubs')], []], {
      currentSeat: 0, openedBySeat: [false, false], publicMelds: [jokerSet(joker)],
    });
    expect(fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('J', 'hearts') })).toBe(s);
  });

  it('rejects a card that is not EXACTLY the represented rank+suit', () => {
    const joker = J();
    const hand = [c('J', 'spades'), c('10', 'hearts'), c('2', 'clubs')];
    const s = baseState([hand, []], { currentSeat: 0, openedBySeat: [true, false], publicMelds: [jokerSet(joker)] });
    // Right rank, wrong suit (J♠ ≠ J♥).
    expect(fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('J', 'spades') })).toBe(s);
    // Right suit, wrong rank (10♥ ≠ J♥).
    expect(fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('10', 'hearts') })).toBe(s);
  });

  it('rejects targeting a non-joker card, and rejects a joker replacing a joker', () => {
    const joker = J();
    const spare = J();
    const s = baseState([[c('J', 'hearts'), spare, c('2', 'clubs')], []], {
      currentSeat: 0, openedBySeat: [true, false], publicMelds: [jokerSet(joker)],
    });
    // The target J♣ is a real card, not a joker.
    expect(fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: '0-clubs-J', card: c('J', 'hearts') })).toBe(s);
    // A second joker may not buy back the first.
    expect(fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: spare })).toBe(s);
  });

  it('rejects a replacement card the player does not hold, and an unknown meld', () => {
    const joker = J();
    const s = baseState([[c('2', 'clubs')], []], { currentSeat: 0, openedBySeat: [true, false], publicMelds: [jokerSet(joker)] });
    expect(fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('J', 'hearts') })).toBe(s);
    const holder = baseState([[c('J', 'hearts'), c('2', 'clubs')], []], {
      currentSeat: 0, openedBySeat: [true, false], publicMelds: [jokerSet(joker)],
    });
    expect(fiftyOneReducer(holder, { type: 'REPLACE_JOKER', meldId: 'nope', jokerCardId: joker.id, card: c('J', 'hearts') })).toBe(holder);
  });

  it('is only legal on your own meld step, never at the draw step', () => {
    const joker = J();
    const s = baseState([[c('J', 'hearts'), c('2', 'clubs')], []], {
      currentSeat: 0, turnStep: 'draw', openedBySeat: [true, false], publicMelds: [jokerSet(joker)],
    });
    expect(fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('J', 'hearts') })).toBe(s);
  });

  it('never empties the hand — the swap is size-neutral, so you still discard to go out', () => {
    const joker = J();
    // A single-card hand: the replacement is the ONLY card held.
    const s = baseState([[c('J', 'hearts')], [c('3', 'clubs')]], {
      currentSeat: 0, openedBySeat: [true, false], publicMelds: [jokerSet(joker)],
    });
    const r = fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('J', 'hearts') }) as FiftyOneState;
    expect(r).not.toBe(s);
    expect(r.handsBySeat[0]).toEqual([joker]); // hand size unchanged: the joker replaced it
    expect(r.phase).toBe('playing');           // no win — the action can never end a round
    // Going out still happens on the discard, which now sheds the joker itself.
    const done = fiftyOneReducer(r, { type: 'DISCARD', card: joker }) as FiftyOneState;
    expect(done.roundWinnerSeat).toBe(0);
  });

  it('keeps the joker-in-hand penalty at 25 when the taker loses with it (§11)', () => {
    const joker = J();
    // Seat 0 buys the joker back, discards, then seat 1 goes out → seat 0 still holds it.
    const s = baseState([[c('J', 'hearts'), c('2', 'clubs')], [c('4', 'clubs')]], {
      currentSeat: 0, openedBySeat: [true, true], publicMelds: [jokerSet(joker)],
    });
    const swapped = fiftyOneReducer(s, { type: 'REPLACE_JOKER', meldId: 'm-1-1-0', jokerCardId: joker.id, card: c('J', 'hearts') }) as FiftyOneState;
    const discarded = fiftyOneReducer(swapped, { type: 'DISCARD', card: c('2', 'clubs') }) as FiftyOneState;
    expect(discarded.currentSeat).toBe(1);
    const drawn = { ...discarded, turnStep: 'meld_discard' as const };
    const out = fiftyOneReducer(drawn, { type: 'DISCARD', card: c('4', 'clubs') }) as FiftyOneState;
    expect(out.roundWinnerSeat).toBe(1);
    expect(out.lastRound?.penaltyBySeat[0]).toBe(25); // the bought-back joker alone
  });
});
