// ---------------------------------------------------------------------------
// 51 online redaction HARDENING (Stage 30.4). The basic per-field redaction is
// covered by redact.test.ts; this file adds the high-signal leak guards that gate
// server-authoritative online (§14): a JSON-payload scan proving NO opponent /
// draw-pile card id, rank, or suit ever reaches the wrong viewer, plus the
// placeholder shape, the public/hidden field split, and the spectator view.
//
// At Stage 30.4 this was readiness only (51 still gated OFF online); online 51 rooms
// went live at Stage 30.5 and 51 was fully released at Stage 30.7. These leak guards
// remain the single gate that keeps every online 51 room leak-proof per viewer.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { fiftyOneRedactStateFor } from './redact';
import { fiftyOneGameDefinition } from './definition';
import type { Rank, Suit } from '../../models/types';
import type { FiftyOneCard, FiftyOneState } from './types';

const c = (rank: Rank, suit: Suit, d = 0): FiftyOneCard => ({ id: `${d}-${suit}-${rank}`, joker: false, suit, rank });
const J = (n: number): FiftyOneCard => ({ id: `joker-${n}`, joker: true, suit: null, rank: null });

/** A rich mid-round state: seat 0 opened (with a joker meld), seats 1–2 not; a
 *  populated draw pile, a discard pile, running scores, and one eliminated seat. */
function sample(): FiftyOneState {
  const meld = {
    id: 'm-1-0-0', ownerSeat: 0, type: 'run' as const,
    cards: [c('7', 'spades'), J(0), c('9', 'spades')],
    jokerRepresents: { 1: { suit: 'spades' as Suit, rank: '8' as Rank } }, value: 24,
  };
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount: 4,
    players: [0, 1, 2, 3].map((i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'ai' as const })),
    dealerSeat: 0, starterSeat: 1, currentSeat: 2, turnStep: 'draw',
    handsBySeat: [
      [c('A', 'hearts'), c('K', 'diamonds')],                 // seat 0 (private)
      [c('2', 'clubs'), c('3', 'clubs'), c('4', 'clubs')],    // seat 1 (private)
      [c('5', 'hearts'), J(1)],                               // seat 2 (private, holds a joker)
      [],                                                      // seat 3 eliminated → empty
    ],
    drawPile: [c('Q', 'hearts'), c('J', 'diamonds'), c('10', 'spades')],
    discardPile: [c('6', 'clubs'), c('7', 'hearts')],
    openedBySeat: [true, false, false, false], publicMelds: [meld],
    scoresBySeat: [12, 30, 220, 540], eliminatedSeats: [false, false, false, true],
    roundNumber: 3, roundWinnerSeat: null, winnerSeat: null,
    lastRound: {
      roundNumber: 2, winnerSeat: 0,
      penaltyBySeat: [0, 18, 40, 100], neverOpenedBySeat: [false, false, false, true], newlyEliminated: [3],
    },
    options: { targetPenalty: 510 },
  };
}

/** The concrete card ids private to `seat` (its hand) — must never leak to others. */
function handIds(state: FiftyOneState, seat: number): string[] {
  return state.handsBySeat[seat].map((x) => x.id);
}
const drawIds = (s: FiftyOneState) => s.drawPile.map((x) => x.id);

const isPlaceholder = (x: FiftyOneCard) => x.id === 'hidden' && x.suit === null && x.rank === null && x.joker === false;

describe('51 redaction hardening — no private card ever leaks (§14)', () => {
  it('a JSON scan of a player view contains NO opponent hand id / draw-pile id', () => {
    const state = sample();
    for (const viewer of [0, 1, 2]) {
      const view = fiftyOneRedactStateFor(state, viewer);
      const json = JSON.stringify(view);
      // Every OTHER seat's real card ids must be absent from the payload…
      for (const seat of [0, 1, 2, 3]) {
        if (seat === viewer) continue;
        for (const id of handIds(state, seat)) {
          expect(json.includes(id), `viewer ${viewer} leaked seat ${seat} card ${id}`).toBe(false);
        }
      }
      // …and the entire draw pile (order + contents) is hidden from everyone.
      for (const id of drawIds(state)) {
        expect(json.includes(id), `viewer ${viewer} leaked draw card ${id}`).toBe(false);
      }
    }
  });

  it('a JSON scan of a player view leaks no opponent joker (joker:true only in own hand / public meld)', () => {
    // Seat 2 privately holds joker-1; seat 0's meld publicly shows joker-0. From
    // seat 0's view, joker-1 (seat 2's hand) must be fully hidden.
    const view = fiftyOneRedactStateFor(sample(), 0);
    const json = JSON.stringify(view);
    expect(json.includes('joker-1')).toBe(false); // opponent's hidden joker
    expect(json.includes('joker-0')).toBe(true);  // public meld joker stays visible
  });

  it('own hand is real; every other hand is a same-length run of blank placeholders', () => {
    const state = sample();
    const view = fiftyOneRedactStateFor(state, 1);
    expect(view.handsBySeat[1]).toEqual(state.handsBySeat[1]);            // own hand untouched
    for (const seat of [0, 2, 3]) {
      expect(view.handsBySeat[seat]).toHaveLength(state.handsBySeat[seat].length); // count kept
      expect(view.handsBySeat[seat].every(isPlaceholder)).toBe(true);    // no id/suit/rank/joker
    }
  });

  it('the draw pile is hidden (count kept, order/contents gone) for a player and a spectator', () => {
    const state = sample();
    for (const viewer of [2, null]) {
      const view = fiftyOneRedactStateFor(state, viewer);
      expect(view.drawPile).toHaveLength(state.drawPile.length);
      expect(view.drawPile.every(isPlaceholder)).toBe(true);
    }
  });

  it('public info survives untouched: discard pile, melds (+joker value), scores, opened, eliminated, turn/step', () => {
    const state = sample();
    const view = fiftyOneRedactStateFor(state, 2);
    expect(view.discardPile).toEqual(state.discardPile);                  // full discard is public
    expect(view.publicMelds).toEqual(state.publicMelds);                  // incl. jokerRepresents
    expect(view.publicMelds[0].jokerRepresents[1]).toEqual({ suit: 'spades', rank: '8' });
    expect(view.scoresBySeat).toEqual(state.scoresBySeat);
    expect(view.openedBySeat).toEqual(state.openedBySeat);
    expect(view.eliminatedSeats).toEqual(state.eliminatedSeats);
    expect(view.currentSeat).toBe(state.currentSeat);
    expect(view.turnStep).toBe(state.turnStep);
    expect(view.roundNumber).toBe(state.roundNumber);
    // lastRound is a public score summary (no cards) — untouched.
    expect(view.lastRound).toEqual(state.lastRound);
  });

  it('a spectator / unknown viewer (null seat) sees NO hand at all', () => {
    const state = sample();
    const view = fiftyOneRedactStateFor(state, null);
    const json = JSON.stringify(view);
    for (const seat of [0, 1, 2, 3]) {
      expect(view.handsBySeat[seat].every(isPlaceholder)).toBe(true);
      for (const id of handIds(state, seat)) expect(json.includes(id)).toBe(false);
    }
    for (const id of drawIds(state)) expect(json.includes(id)).toBe(false);
  });

  it('redaction is pure — it never mutates the authoritative state', () => {
    const state = sample();
    const before = JSON.stringify(state);
    fiftyOneRedactStateFor(state, 0);
    fiftyOneRedactStateFor(state, null);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('the redacted state carries no debug/log/history side-channel (only §14 fields exist)', () => {
    // 51's state shape is a fixed allow-list of public + own-hand fields; guard that
    // no ad-hoc leak field (a common regression) sneaks a private payload past redaction.
    const view = fiftyOneRedactStateFor(sample(), 1) as unknown as Record<string, unknown>;
    for (const forbidden of ['lastAction', 'debug', 'log', 'history', 'deck', 'seed', 'rng']) {
      expect(forbidden in view, `state must not expose ${forbidden}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// FAIL 1 (Stage 37.3 hardening): the internal server-authoritative accumulators
// `telemetry` (carries `twoJokerDealBySeat` — a private-hand fact about another
// seat) and `turnHasPassed` must NEVER reach a client viewer or spectator, and
// redaction must not mutate the authoritative state.
// ---------------------------------------------------------------------------

/** A mid-round state carrying Stage 37.3 internal accumulators (as the server holds). */
function withTelemetry(): FiftyOneState {
  return {
    ...sample(),
    // seat 2 was dealt two jokers this game — a PRIVATE fact that must not leak.
    telemetry: {
      neverOpenedGameBySeat: [false, true, true, false],
      tookHundredBySeat: [false, false, true, true],
      twoJokerDealBySeat: [false, false, true, false],
      instantRoundWinBySeat: [true, false, false, false],
    },
    turnHasPassed: true,
  };
}

/** The internal accumulator keys that must be absent from any serialized client view. */
const INTERNAL_KEYS = ['telemetry', 'turnHasPassed', 'twoJokerDealBySeat', 'neverOpenedGameBySeat',
  'tookHundredBySeat', 'instantRoundWinBySeat'];

describe('51 redaction — internal telemetry never leaks (§14, FAIL 1)', () => {
  it('the owner (viewer at their own seat) receives no telemetry / turnHasPassed', () => {
    const view = fiftyOneRedactStateFor(withTelemetry(), 0);
    expect(view.telemetry).toBeUndefined();
    expect(view.turnHasPassed).toBeUndefined();
  });

  it('an opponent receives no telemetry / turnHasPassed', () => {
    const view = fiftyOneRedactStateFor(withTelemetry(), 1);
    expect(view.telemetry).toBeUndefined();
    expect(view.turnHasPassed).toBeUndefined();
  });

  it('a spectator (null seat) receives no telemetry / turnHasPassed', () => {
    const view = fiftyOneRedactStateFor(withTelemetry(), null);
    expect(view.telemetry).toBeUndefined();
    expect(view.turnHasPassed).toBeUndefined();
  });

  it('JSON.stringify(view) contains none of the internal accumulator keys, for every viewer', () => {
    const state = withTelemetry();
    for (const viewer of [0, 1, 2, 3, null]) {
      const json = JSON.stringify(fiftyOneRedactStateFor(state, viewer));
      for (const key of INTERNAL_KEYS) {
        expect(json.includes(key), `viewer ${viewer} leaked internal key ${key}`).toBe(false);
      }
    }
  });

  it('redaction does not mutate the authoritative state (telemetry preserved server-side)', () => {
    const state = withTelemetry();
    const before = JSON.stringify(state);
    fiftyOneRedactStateFor(state, 0);
    fiftyOneRedactStateFor(state, null);
    expect(JSON.stringify(state)).toBe(before);       // untouched
    expect(state.telemetry?.twoJokerDealBySeat[2]).toBe(true); // still authoritative
    expect(state.turnHasPassed).toBe(true);
  });

  it('the online path (GameDefinition.redactStateFor) and reconnect snapshot also strip telemetry', () => {
    // serverCore builds every broadcast + reconnect snapshot via def.redactStateFor.
    const state = withTelemetry();
    for (const viewer of [2, null]) {
      const view = fiftyOneGameDefinition.redactStateFor(state, viewer);
      expect(view.telemetry).toBeUndefined();
      expect(view.turnHasPassed).toBeUndefined();
      expect(JSON.stringify(view).includes('twoJokerDealBySeat')).toBe(false);
    }
    // The authoritative copy still holds telemetry for the finish summarizer.
    expect(state.telemetry).toBeDefined();
  });
});
