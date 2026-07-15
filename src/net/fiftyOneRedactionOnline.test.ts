// ---------------------------------------------------------------------------
// 51 ONLINE redaction (Stage 30.5). Now that 51 is hostable online, prove the
// server never ships a hand a client shouldn't see, using the SAME functions the
// WS layer uses (startGame / sanitizedStateFor / serialize+deserialize / roomSummary)
// on a real 2-human + bot room. Complements fiftyOne/redaction.test.ts (pure
// redactor) and fiftyOneServerCore.test.ts (single-viewer drive) with the multi-
// client privacy angle: A never sees B, B never sees A, bot hands hidden, reconnect
// snapshot still redacted, and no draw-pile order in any client payload.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, applyBotTurn, actingMember, applyActionRequest,
  sanitizedStateFor, roomSummary, serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import type { AnyGameAction } from '../games/anyGame';
import type { FiftyOneState } from '../games/fiftyOne/types';

const asF = (s: unknown) => s as unknown as FiftyOneState;

/** A started 51 room: 2 humans (A host seat 0, B seat 1) + 1 bot (seat 2). */
function humanBotRoom(seed: number): ServerRoom {
  const room = createRoom({
    code: '51ON', gameType: 'fifty-one', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'A', reconnectToken: 'tA', name: 'Alice' }, now: 1,
  });
  addMember(room, { clientId: 'B', reconnectToken: 'tB', name: 'Bob' });
  addBot(room, 'A', { clientId: 'bot', reconnectToken: 'tbot' });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  return room;
}

/** Every real (non-hidden, non-joker) card id in a seat's authoritative hand. */
const handIds = (real: FiftyOneState, seat: number) => real.handsBySeat[seat].map((c) => c.id);
const drawIds = (real: FiftyOneState) => real.drawPile.map((c) => c.id);

describe('51 online redaction — a client only ever sees its own hand (Stage 30.5)', () => {
  it('Alice sees her hand; Bob\'s + the bot\'s hands + the draw pile never appear in her payload', () => {
    const room = humanBotRoom(7);
    const real = asF(room.gameState);
    const view = asF(sanitizedStateFor(room, 'A')); // A = seat 0
    const json = JSON.stringify(view);

    expect(view.handsBySeat[0]).toEqual(real.handsBySeat[0]); // own hand real
    for (const seat of [1, 2]) {
      expect(view.handsBySeat[seat]).toHaveLength(real.handsBySeat[seat].length); // count kept
      expect(view.handsBySeat[seat].every((c) => c.id === 'hidden')).toBe(true);
      for (const id of handIds(real, seat)) expect(json.includes(id), `A leaked seat ${seat} ${id}`).toBe(false);
    }
    // Draw pile order/contents hidden from everyone (count kept).
    expect(view.drawPile.every((c) => c.id === 'hidden')).toBe(true);
    for (const id of drawIds(real)) expect(json.includes(id), `A leaked draw ${id}`).toBe(false);
  });

  it('Bob sees his own hand and NOT Alice\'s (mutual non-leak)', () => {
    const room = humanBotRoom(11);
    const real = asF(room.gameState);
    const view = asF(sanitizedStateFor(room, 'B')); // B = seat 1
    const json = JSON.stringify(view);
    expect(view.handsBySeat[1]).toEqual(real.handsBySeat[1]);
    for (const id of handIds(real, 0)) expect(json.includes(id), `B leaked Alice ${id}`).toBe(false);
    expect(view.handsBySeat[0].every((c) => c.id === 'hidden')).toBe(true);
  });

  it('public info (discard pile, melds, scores, opened, turn) stays visible after redaction', () => {
    const room = humanBotRoom(3);
    // Advance a few bot moves so a discard/meld exists to check publicly.
    for (let i = 0; i < 8 && actingMember(room)?.type === 'ai'; i++) applyBotTurn(room);
    const real = asF(room.gameState);
    const view = asF(sanitizedStateFor(room, 'B'));
    expect(view.discardPile).toEqual(real.discardPile);
    expect(view.publicMelds).toEqual(real.publicMelds);
    expect(view.scoresBySeat).toEqual(real.scoresBySeat);
    expect(view.openedBySeat).toEqual(real.openedBySeat);
    expect(view.currentSeat).toBe(real.currentSeat);
  });

  it('a reconnect (serialize → deserialize) keeps the state redacted per viewer', () => {
    const room = humanBotRoom(21);
    const real = asF(room.gameState);
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.gameType).toBe('fifty-one');
    const view = asF(sanitizedStateFor(restored, 'A'));
    const json = JSON.stringify(view);
    expect(view.handsBySeat[0].every((c) => c.id !== 'hidden')).toBe(true); // own hand intact
    for (const seat of [1, 2]) {
      expect(view.handsBySeat[seat].every((c) => c.id === 'hidden')).toBe(true);
      for (const id of handIds(real, seat)) expect(json.includes(id)).toBe(false);
    }
  });

  it('the public room summary never contains any hand or draw-pile card', () => {
    const room = humanBotRoom(33);
    const real = asF(room.gameState);
    const summary = roomSummary(room);
    const json = JSON.stringify(summary);
    expect(summary.gameType).toBe('fifty-one');
    expect('gameState' in summary).toBe(false);
    for (const seat of [0, 1, 2]) for (const id of handIds(real, seat)) expect(json.includes(id)).toBe(false);
    for (const id of drawIds(real)) expect(json.includes(id)).toBe(false);
  });

  it('a bought-back joker (30.14) is public in the meld it left, private in the hand it entered', () => {
    // Alice (seat 0) swaps her J♥ for a joker standing in as J♥ on a public set.
    const room = humanBotRoom(11);
    const s = asF(room.gameState);
    const joker = { id: 'joker-0', joker: true, suit: null, rank: null } as const;
    s.currentSeat = 0;
    s.turnStep = 'meld_discard';
    s.openedBySeat[0] = true;
    s.handsBySeat[0] = [
      { id: 'own-jh', joker: false, suit: 'hearts', rank: 'J' },
      { id: 'own-spare', joker: false, suit: 'clubs', rank: '2' },
    ];
    s.publicMelds = [{
      id: 'pm', ownerSeat: 1, type: 'set',
      cards: [
        { id: 'pub-jc', joker: false, suit: 'clubs', rank: 'J' },
        { id: 'pub-jd', joker: false, suit: 'diamonds', rank: 'J' },
        { ...joker },
      ],
      jokerRepresents: { 2: { suit: 'hearts', rank: 'J' } }, value: 30,
    }];
    const res = applyActionRequest(room, 'A',
      { type: 'REPLACE_JOKER', meldId: 'pm', jokerCardId: 'joker-0', card: s.handsBySeat[0][0] } as AnyGameAction);
    expect(res.ok).toBe(true);

    const bobView = asF(sanitizedStateFor(room, 'B'));
    const bobJson = JSON.stringify(bobView);
    // The MELD change is public: Bob sees the real J♥ in it and no joker left there.
    expect(bobView.publicMelds[0].cards.map((c) => c.id)).toEqual(['pub-jc', 'pub-jd', 'own-jh']);
    expect(bobView.publicMelds[0].cards.some((c) => c.joker)).toBe(false);
    // Alice's HAND is not: Bob sees a placeholder count, never the joker's id.
    expect(bobView.handsBySeat[0].every((c) => c.id === 'hidden')).toBe(true);
    expect(bobJson.includes('joker-0')).toBe(false);
    expect(bobJson.includes('own-spare')).toBe(false);
    // Alice herself sees the joker she just took.
    const aliceView = asF(sanitizedStateFor(room, 'A'));
    expect(aliceView.handsBySeat[0].some((c) => c.joker)).toBe(true);
  });

  it('an unknown viewer (spectator seat null) sees no real hand', () => {
    const room = humanBotRoom(5);
    const view = asF(sanitizedStateFor(room, 'ghost'));
    for (const hand of view.handsBySeat) expect(hand.every((c) => c.id === 'hidden')).toBe(true);
  });
});
