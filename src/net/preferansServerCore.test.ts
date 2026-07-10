// ---------------------------------------------------------------------------
// Preferans online SEAM readiness (Stage 19.4). Drives Preferans through the SAME
// server-authoritative functions the WS layer uses (startGame / applyActionRequest
// / applyBotTurn / applyTimeoutAction / autoAdvance / sanitizedStateFor /
// serialize+deserialize), proving the game is technically ready for online play —
// even though it is STILL not hostable: GAME_CATALOG.preferans.supportsOnline =
// false, so wsHandlers rejects CREATE_ROOM preferans (see wsHandlers.preferans.test).
// Mirrors tarneebServerCore.test.ts, which validated Tarneeb's seam before hosting.
//
// Nothing here makes Preferans user-hostable: these call serverCore directly. The
// registry stores definitions as GameDefinition<any, any>, so the seam runs the
// Preferans reducer/redaction without Preferans being in the wire AnyGame union yet.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, applyActionRequest, applyBotTurn,
  applyTimeoutAction, autoAdvance, publicScreenOf, actingMember,
  sanitizedStateFor, serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import { getValidPlayableCards } from '../games/preferans/rules';
import { nextSeat } from '../games/preferans/deck';
import type { AnyGameAction } from '../games/anyGame';
import type { PreferansState } from '../games/preferans/types';

const def = getGameDefinition('preferans')!;
const asP = (s: unknown) => s as unknown as PreferansState;
/** The Preferans reducer/bot are `any`-typed at the registry boundary; wrap the
 *  bot move so it satisfies the AnyGameAction param without widening the union. */
const bot = (s: PreferansState): AnyGameAction => def.botAction(s) as AnyGameAction;

/** A started Preferans room: host (seat 0, human) + 2 bots. Internal only —
 *  Preferans is NOT hostable online from the UI; this exercises serverCore. */
function botRoom(seed: number): ServerRoom {
  const room = createRoom({
    code: 'PREF', gameType: 'preferans', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, now: 1,
  });
  for (let i = 1; i < 3; i++) addBot(room, 'host', { clientId: `bot-${i}`, reconnectToken: `bt-${i}` });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  return room;
}

/** A started 3-human Preferans room, addressable by seat (to test authorization). */
function seatedRoom(seed: number): { room: ServerRoom; clientForSeat: (seat: number) => string } {
  const room = createRoom({
    code: 'PREF', gameType: 'preferans', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'cA', reconnectToken: 'tA', name: 'A' }, now: 1,
  });
  addMember(room, { clientId: 'cB', reconnectToken: 'tB', name: 'B' });
  addMember(room, { clientId: 'cC', reconnectToken: 'tC', name: 'C' });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  const clientForSeat = (seat: number) => {
    for (const [cid, m] of room.members) if (m.seatIndex === seat) return cid;
    throw new Error(`no client at seat ${seat}`);
  };
  return { room, clientForSeat };
}

const actingSeat = (room: ServerRoom): number | null => {
  const id = def.getActingPlayerId(asP(room.gameState));
  return id ? Number(id.split('-')[1]) : null;
};

/** Drive the acting seat's legal heuristic move through the authorised path,
 *  auto-advancing the public `hand_complete` screen via the seeded autoAdvance. */
function drive(room: ServerRoom, opts: { stopPhase?: PreferansState['phase']; seedGen?: () => number; cap?: number } = {}): void {
  const seedGen = opts.seedGen ?? (() => 4242);
  let guard = 0;
  while (guard++ < (opts.cap ?? 20000)) {
    const s = asP(room.gameState);
    if (def.isFinished(s)) break;
    if (opts.stopPhase && s.phase === opts.stopPhase) break;
    if (s.phase === 'hand_complete') { autoAdvance(room, { seed: seedGen() }); continue; }
    const m = actingMember(room);
    if (!m) break;
    const ok = m.type === 'ai' ? applyBotTurn(room).acted : applyActionRequest(room, m.clientId, bot(s)).ok;
    expect(ok).toBe(true);
  }
}

describe('serverCore runs Preferans internally (Stage 19.4)', () => {
  it('createRoom(gameType:preferans) + startGame builds a PreferansState (bidding, 3×10 + talon)', () => {
    const room = botRoom(7);
    expect(room.gameType).toBe('preferans');
    const s = asP(room.gameState);
    expect(s.gameType).toBe('preferans');
    expect(s.phase).toBe('bidding');
    expect(s.players).toHaveLength(3);
    expect(s.handsBySeat.every((h) => h.length === 10)).toBe(true);
    expect(s.talon).toHaveLength(2);
    // The 30 dealt + 2 talon are the full, unique 32-card deck.
    const all = [...s.handsBySeat.flat(), ...s.talon].map((c) => `${c.rank}${c.suit}`);
    expect(new Set(all).size).toBe(32);
    // First bidder is left of the dealer (PREFERANS §2/§5).
    expect(s.currentSeat).toBe(nextSeat(s.dealerSeat));
  });

  it('sanitizedStateFor shows the viewer their own hand, hides opponents + talon + discards', () => {
    const room = botRoom(11);
    const real = asP(room.gameState);
    const before = JSON.stringify(real);
    const view = asP(sanitizedStateFor(room, 'host')); // host = seat 0
    expect(view.handsBySeat[0]).toEqual(real.handsBySeat[0]);     // own hand real
    for (const seat of [1, 2]) {
      expect(view.handsBySeat[seat]).toHaveLength(10);            // count preserved
      expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
    }
    // The un-taken talon is hidden from everyone.
    expect(view.talon).toHaveLength(2);
    expect(view.talon.every((c) => c.rank === '?')).toBe(true);
    // Public fields survive redaction untouched.
    expect(view.bids).toEqual(real.bids);
    expect(view.highBid).toEqual(real.highBid);
    expect(view.scores).toEqual(real.scores);
    expect(view.tricksBySeat).toEqual(real.tricksBySeat);
    // Redaction must NOT mutate the authoritative state.
    expect(JSON.stringify(room.gameState)).toBe(before);
  });

  it('a spectator (null viewer) sees no real hand', () => {
    const room = botRoom(3);
    const spectator = asP(sanitizedStateFor(room, 'nobody')); // unknown client → seat null
    expect(spectator.handsBySeat.every((h) => h.every((c) => c.rank === '?'))).toBe(true);
  });

  it('authorises only the acting seat: an out-of-turn action is rejected', () => {
    const { room, clientForSeat } = seatedRoom(9);
    const actor = actingSeat(room)!;
    const other = (actor + 1) % 3;
    const bad = applyActionRequest(room, clientForSeat(other), { type: 'PASS_BID' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('NOT_YOUR_TURN');
    const before = JSON.stringify(room.gameState);
    const good = applyActionRequest(room, clientForSeat(actor), bot(asP(room.gameState)));
    expect(good.ok).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before);
  });

  it('the declarer alone takes the talon after the auction', () => {
    const { room, clientForSeat } = seatedRoom(5);
    drive(room, { stopPhase: 'talon' });
    const s = asP(room.gameState);
    expect(s.phase).toBe('talon');
    const declarer = s.declarerSeat!;
    const nonDeclarer = (declarer + 1) % 3;
    // A non-declarer cannot take the talon (only the declarer is the acting seat).
    const bad = applyActionRequest(room, clientForSeat(nonDeclarer), { type: 'TAKE_TALON' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('NOT_YOUR_TURN');
    const ok = applyActionRequest(room, clientForSeat(declarer), { type: 'TAKE_TALON' });
    expect(ok.ok).toBe(true);
    expect(asP(room.gameState).handsBySeat[declarer]).toHaveLength(12);
  });

  it('enforces follow-suit: an off-suit card while holding the led suit is rejected', () => {
    const { room, clientForSeat } = seatedRoom(2);
    let found = false;
    let guard = 0;
    while (guard++ < 6000 && !def.isFinished(room.gameState!)) {
      const s = asP(room.gameState);
      if (s.phase === 'hand_complete') { autoAdvance(room, { seed: 100 + guard }); continue; }
      const seat = actingSeat(room);
      if (seat == null) break;
      const cid = clientForSeat(seat);
      if (s.phase === 'playing' && s.currentTrick && s.currentTrick.plays.length > 0 && s.currentTrick.ledSuit) {
        const led = s.currentTrick.ledSuit;
        const hand = s.handsBySeat[seat];
        const offSuit = hand.find((c) => c.suit !== led);
        if (offSuit && hand.some((c) => c.suit === led)) {
          const bad = applyActionRequest(room, cid, { type: 'PLAY_CARD', card: offSuit });
          expect(bad.ok).toBe(false);
          expect(bad.error).toBe('ILLEGAL_ACTION');
          const legal = getValidPlayableCards(s, seat)[0];
          expect(applyActionRequest(room, cid, { type: 'PLAY_CARD', card: legal }).ok).toBe(true);
          found = true;
          continue;
        }
      }
      applyActionRequest(room, cid, bot(s));
    }
    expect(found).toBe(true);
  });

  it('applyBotTurn progresses a bot; applyTimeoutAction auto-plays for a human actor', () => {
    const botR = botRoom(13);
    // Advance the human (seat 0) until a bot is the actor, then let the bot move.
    let guard = 0;
    while (guard++ < 20 && actingMember(botR)?.type === 'human') {
      const m = actingMember(botR)!;
      applyActionRequest(botR, m.clientId, bot(asP(botR.gameState)));
    }
    expect(actingMember(botR)?.type).toBe('ai');
    const before = JSON.stringify(botR.gameState);
    expect(applyBotTurn(botR).acted).toBe(true);
    expect(JSON.stringify(botR.gameState)).not.toBe(before);

    const { room } = seatedRoom(8);
    expect(actingMember(room)?.type).toBe('human');
    const before2 = JSON.stringify(room.gameState);
    expect(applyTimeoutAction(room).acted).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before2);
  });

  it('serialize → deserialize preserves the Preferans game mid-play; redaction still works', () => {
    const { room } = seatedRoom(21);
    drive(room, { stopPhase: 'playing' });
    for (let i = 0; i < 2 && asP(room.gameState).phase === 'playing'; i++) {
      const m = actingMember(room);
      if (!m) break;
      applyActionRequest(room, m.clientId, bot(asP(room.gameState)));
    }
    const beforeState = asP(room.gameState);
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.gameType).toBe('preferans');
    const after = asP(restored.gameState);
    for (const k of ['phase', 'dealerSeat', 'currentSeat', 'declarerSeat', 'handNumber'] as const) {
      expect(after[k], `restart preserves ${k}`).toEqual(beforeState[k]);
    }
    expect(after.contract).toEqual(beforeState.contract);
    expect(after.scores).toEqual(beforeState.scores);
    expect(after.tricksBySeat).toEqual(beforeState.tricksBySeat);
    expect(after.currentTrick).toEqual(beforeState.currentTrick);
    expect(after.handsBySeat).toEqual(beforeState.handsBySeat);
    // Redaction after restore still hides opponents for the seat-0 viewer.
    const view = asP(sanitizedStateFor(restored, 'cA'));
    expect(view.handsBySeat[0].every((c) => c.rank !== '?')).toBe(true);
    for (const seat of [1, 2]) expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
  });
});

describe('Preferans public hand_complete advances server-side (Stage 19.4)', () => {
  it('hand_complete is a public round_scoring screen that autoAdvance seeds to the next hand', () => {
    const room = botRoom(4);
    drive(room, { stopPhase: 'hand_complete' });
    const s = asP(room.gameState);
    expect(s.phase).toBe('hand_complete');
    expect(def.isFinished(s)).toBe(false);
    // No seat acts on this screen → the room reports the generic round_scoring pause.
    expect(actingMember(room)).toBeNull();
    expect(publicScreenOf(room)).toBe('round_scoring');
    const prevDealer = s.dealerSeat;
    expect(autoAdvance(room, { seed: 555 })).toBe(true);
    const next = asP(room.gameState);
    expect(next.phase).toBe('bidding');
    expect(next.handNumber).toBe(s.handNumber + 1);
    expect(next.dealerSeat).toBe(nextSeat(prevDealer)); // dealer rotates left
  });

  it('the redeal is server-seeded: same seed → identical next hand', () => {
    const redealWith = (seed: number): PreferansState => {
      const room = botRoom(4);
      drive(room, { stopPhase: 'hand_complete' });
      autoAdvance(room, { seed });
      return asP(room.gameState);
    };
    expect(redealWith(999).handsBySeat).toEqual(redealWith(999).handsBySeat);
  });

  it('a bot-only room reaches game_finished, and a finished game does NOT auto-advance', () => {
    const room = botRoom(31);
    let k = 3000;
    drive(room, { seedGen: () => ++k });
    const s = asP(room.gameState);
    expect(def.isFinished(s)).toBe(true);
    expect(s.phase).toBe('game_finished');
    // The match ends once a score reaches the target; winnerSeat is a seat or null (draw).
    expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(s.targetScore);
    expect(s.winnerSeat === null || (s.winnerSeat >= 0 && s.winnerSeat < 3)).toBe(true);
    // Terminal: no public screen, no advance.
    expect(publicScreenOf(room)).toBeNull();
    expect(autoAdvance(room, { seed: 1 })).toBe(false);
  });
});
