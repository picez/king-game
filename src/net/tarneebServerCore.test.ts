// ---------------------------------------------------------------------------
// Tarneeb online seam (Stage 10.4). Drives Tarneeb through the SAME
// server-authoritative functions the WS layer uses (startGame / applyActionRequest
// / applyBotTurn / applyTimeoutAction / autoAdvance / sanitizedStateFor /
// serialize+deserialize), proving the game is technically ready for online play —
// even though it is STILL not hostable (GAME_CATALOG.tarneeb.supportsOnline =
// false; wsHandlers rejects CREATE_ROOM tarneeb). Mirrors debercServerCore.test.ts
// / durakServerCore.test.ts in spirit.
//
// Nothing here makes Tarneeb user-hostable: these call serverCore directly, the
// same way the Durak/Deberc seams were validated before their UI landed.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, applyActionRequest, applyBotTurn,
  applyTimeoutAction, autoAdvance, publicScreenOf, actingMember,
  sanitizedStateFor, serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import { getValidPlayableCards, nextSeatCounterClockwise, teamOfSeat } from '../games/tarneeb/rules';
import type { TarneebAction, TarneebState } from '../games/tarneeb/types';

const def = getGameDefinition('tarneeb')!;

/** A started Tarneeb room: host (seat 0, human) + 3 bots. Internal only —
 *  Tarneeb is NOT hostable online from the UI; this exercises serverCore. */
function botRoom(seed: number): ServerRoom {
  const room = createRoom({
    code: 'TRNB', gameType: 'tarneeb', playerCount: 4, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, now: 1,
  });
  for (let i = 1; i < 4; i++) addBot(room, 'host', { clientId: `bot-${i}`, reconnectToken: `bt-${i}` });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  return room;
}

/** A started 4-human Tarneeb room, addressable by seat, so we can send actions as
 *  any seat (to test authorization). All four are humans; the AI heuristic still
 *  drives each seat's legal move through the authorised path. */
function seatedRoom(seed: number): { room: ServerRoom; clientForSeat: (seat: number) => string } {
  const room = createRoom({
    code: 'TRNB', gameType: 'tarneeb', playerCount: 4, modeSelectionType: 'fixed',
    host: { clientId: 'cA', reconnectToken: 'tA', name: 'A' }, now: 1,
  });
  addMember(room, { clientId: 'cB', reconnectToken: 'tB', name: 'B' });
  addMember(room, { clientId: 'cC', reconnectToken: 'tC', name: 'C' });
  addMember(room, { clientId: 'cD', reconnectToken: 'tD', name: 'D' });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  const clientForSeat = (seat: number) => {
    for (const [cid, m] of room.members) if (m.seatIndex === seat) return cid;
    throw new Error(`no client at seat ${seat}`);
  };
  return { room, clientForSeat };
}

const actingSeat = (room: ServerRoom): number | null => {
  const id = def.getActingPlayerId(room.gameState as TarneebState);
  return id ? Number(id.split('-')[1]) : null;
};

/** Apply the acting seat's legal heuristic move through the authorised path,
 *  advancing public `hand_complete` screens via the seeded autoAdvance. Stops at
 *  `stopPhase`, when finished, or after `cap` steps. Never calls autoAdvance on a
 *  seat-turn, so callers can inspect a phase before it is advanced. */
function drive(room: ServerRoom, opts: { stopPhase?: TarneebState['phase']; seedGen?: () => number; cap?: number } = {}): void {
  const seedGen = opts.seedGen ?? (() => 4242);
  let guard = 0;
  while (guard++ < (opts.cap ?? 20000)) {
    const s = room.gameState as TarneebState;
    if (def.isFinished(s)) break;
    if (opts.stopPhase && s.phase === opts.stopPhase) break;
    if (s.phase === 'hand_complete') { autoAdvance(room, { seed: seedGen() }); continue; }
    const m = actingMember(room);
    if (!m) break;
    const ok = m.type === 'ai'
      ? applyBotTurn(room).acted
      : applyActionRequest(room, m.clientId, def.botAction(s)!).ok;
    expect(ok).toBe(true);
  }
}

describe('serverCore runs Tarneeb internally (Stage 10.4)', () => {
  it('createRoom(gameType:tarneeb) + startGame builds a TarneebState (bidding, 4×13, fixed teams)', () => {
    const room = botRoom(7);
    expect(room.gameType).toBe('tarneeb');
    const s = room.gameState as TarneebState;
    expect(s.gameType).toBe('tarneeb');
    expect(s.phase).toBe('bidding');
    expect(s.players).toHaveLength(4);
    expect(s.handsBySeat.every((h) => h.length === 13)).toBe(true);
    // Union of all hands is the full 52-card deck (no dupes, none missing).
    const all = s.handsBySeat.flat().map((c) => `${c.rank}${c.suit}`);
    expect(new Set(all).size).toBe(52);
    // Fixed 2×2 partnerships and CCW first bidder (dealer's right) per TARNEEB §2/§4.
    expect(s.teams).toEqual({ A: [0, 2], B: [1, 3] });
    expect(s.currentSeat).toBe(nextSeatCounterClockwise(s.dealerSeat));
    expect(room.dealLog).toHaveLength(0); // Tarneeb keeps no King-style deal audit
  });

  it('sanitizedStateFor shows the viewer their own hand and hides opponents (count-only)', () => {
    const room = botRoom(11);
    const real = room.gameState as TarneebState;
    const before = JSON.stringify(real);
    const view = sanitizedStateFor(room, 'host') as TarneebState; // host = seat 0
    expect(view.handsBySeat[0]).toEqual(real.handsBySeat[0]);     // own hand real
    for (const seat of [1, 2, 3]) {
      expect(view.handsBySeat[seat]).toHaveLength(13);            // count preserved
      expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
    }
    // Public fields survive redaction untouched.
    expect(view.bids).toEqual(real.bids);
    expect(view.highestBid).toEqual(real.highestBid);
    expect(view.trumpSuit).toEqual(real.trumpSuit);
    expect(view.currentTrick).toEqual(real.currentTrick);
    expect(view.tricksByTeam).toEqual(real.tricksByTeam);
    expect(view.scoresByTeam).toEqual(real.scoresByTeam);
    // Redaction must NOT mutate the authoritative state.
    expect(JSON.stringify(room.gameState)).toBe(before);
  });

  it('a spectator (null viewer) sees no real hand', () => {
    const room = botRoom(3);
    const spectator = sanitizedStateFor(room, 'nobody') as TarneebState; // unknown → seat null
    expect(spectator.handsBySeat.every((h) => h.every((c) => c.rank === '?'))).toBe(true);
  });

  it('authorises only the acting seat: an out-of-turn action is rejected', () => {
    const { room, clientForSeat } = seatedRoom(9);
    const actor = actingSeat(room)!;
    const other = (actor + 1) % 4;
    // A non-actor's PASS_BID is refused before the reducer even runs.
    const bad = applyActionRequest(room, clientForSeat(other), { type: 'PASS_BID' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('NOT_YOUR_TURN');
    // The actor's move is accepted and advances the state.
    const before = JSON.stringify(room.gameState);
    const good = applyActionRequest(room, clientForSeat(actor), def.botAction(room.gameState as TarneebState)!);
    expect(good.ok).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before);
  });

  it('the declarer alone may choose trump after the auction', () => {
    const { room, clientForSeat } = seatedRoom(5);
    drive(room, { stopPhase: 'choosing_trump' });
    const s = room.gameState as TarneebState;
    expect(s.phase).toBe('choosing_trump');
    const declarer = s.declarerSeat!;
    const nonDeclarer = (declarer + 1) % 4;
    // A non-declarer cannot name trump (only the declarer is the acting seat).
    const bad = applyActionRequest(room, clientForSeat(nonDeclarer), { type: 'CHOOSE_TRUMP', suit: 'spades' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('NOT_YOUR_TURN');
    // The declarer names trump → playing phase, trump set, declarer leads.
    const ok = applyActionRequest(room, clientForSeat(declarer), { type: 'CHOOSE_TRUMP', suit: 'spades' });
    expect(ok.ok).toBe(true);
    const after = room.gameState as TarneebState;
    expect(after.phase).toBe('playing');
    expect(after.trumpSuit).toBe('spades');
    expect(after.currentSeat).toBe(declarer); // declarer leads the first trick (§7)
  });

  it('enforces follow-suit: an off-suit card while holding the led suit is rejected', () => {
    const { room, clientForSeat } = seatedRoom(2);
    let found = false;
    let guard = 0;
    while (guard++ < 6000 && !def.isFinished(room.gameState!)) {
      const s = room.gameState as TarneebState;
      if (s.phase === 'hand_complete') { autoAdvance(room, { seed: 100 + guard }); continue; }
      const seat = actingSeat(room);
      if (seat == null) break;
      const cid = clientForSeat(seat);
      if (s.phase === 'playing' && s.currentTrick && s.currentTrick.plays.length > 0 && s.currentTrick.ledSuit) {
        const led = s.currentTrick.ledSuit;
        const hand = s.handsBySeat[seat];
        const offSuit = hand.find((c) => c.suit !== led);
        if (offSuit && hand.some((c) => c.suit === led)) {
          // Illegal: discarding off-suit while able to follow.
          const bad = applyActionRequest(room, cid, { type: 'PLAY_CARD', card: offSuit });
          expect(bad.ok).toBe(false);
          expect(bad.error).toBe('ILLEGAL_ACTION');
          // A legal led-suit card is accepted through the same path.
          const legal = getValidPlayableCards(s, seat)[0];
          expect(applyActionRequest(room, cid, { type: 'PLAY_CARD', card: legal }).ok).toBe(true);
          found = true;
          continue;
        }
      }
      applyActionRequest(room, cid, def.botAction(s)!);
    }
    expect(found).toBe(true);
  });

  it('applyBotTurn progresses a bot through the authorised reducer path', () => {
    const room = botRoom(13);
    // Advance humans (seat 0) until a bot is the actor, then let the bot move.
    let guard = 0;
    while (guard++ < 20 && actingMember(room)?.type === 'human') {
      const m = actingMember(room)!;
      applyActionRequest(room, m.clientId, def.botAction(room.gameState as TarneebState)!);
    }
    expect(actingMember(room)?.type).toBe('ai');
    const before = JSON.stringify(room.gameState);
    expect(applyBotTurn(room).acted).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before);
  });

  it('applyTimeoutAction auto-plays for the current (human) actor via tarneebBotAction', () => {
    const { room } = seatedRoom(8);
    expect(actingMember(room)?.type).toBe('human');
    const before = JSON.stringify(room.gameState);
    expect(applyTimeoutAction(room).acted).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before);
  });

  it('serialize → deserialize preserves the Tarneeb game mid-play; redaction still works', () => {
    const { room } = seatedRoom(21);
    drive(room, { stopPhase: 'playing' });
    // Play a couple of cards so a trick is in progress (trump + bids + hands set).
    for (let i = 0; i < 2 && (room.gameState as TarneebState).phase === 'playing'; i++) {
      const m = actingMember(room);
      if (!m) break;
      applyActionRequest(room, m.clientId, def.botAction(room.gameState as TarneebState)!);
    }
    const before = room.gameState as TarneebState;
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.gameType).toBe('tarneeb');
    const after = restored.gameState as TarneebState;
    for (const k of ['phase', 'dealerSeat', 'currentSeat', 'declarerSeat', 'declarerTeam',
      'trumpSuit', 'handNumber'] as const) {
      expect(after[k], `restart preserves ${k}`).toEqual(before[k]);
    }
    expect(after.bids).toEqual(before.bids);
    expect(after.highestBid).toEqual(before.highestBid);
    expect(after.scoresByTeam).toEqual(before.scoresByTeam);
    expect(after.tricksByTeam).toEqual(before.tricksByTeam);
    expect(after.currentTrick).toEqual(before.currentTrick);
    expect(after.handsBySeat).toEqual(before.handsBySeat);
    // Redaction after restore still hides opponents for the seat-0 viewer.
    const view = sanitizedStateFor(restored, 'cA') as TarneebState;
    expect(view.handsBySeat[0].every((c) => c.rank !== '?')).toBe(true);
    for (const seat of [1, 2, 3]) expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
  });
});

describe('Tarneeb public hand_complete advances server-side (Stage 10.4)', () => {
  it('hand_complete is a public screen (round_scoring) that autoAdvance seeds to the next hand', () => {
    const room = botRoom(4);
    // Drive one full hand (target 41 → a single +≤13 hand can never finish yet).
    drive(room, { stopPhase: 'hand_complete' });
    const s = room.gameState as TarneebState;
    expect(s.phase).toBe('hand_complete');
    expect(def.isFinished(s)).toBe(false);
    // No seat acts on this screen → the room reports the generic round_scoring pause.
    expect(actingMember(room)).toBeNull();
    expect(publicScreenOf(room)).toBe('round_scoring');
    const prevDealer = s.dealerSeat;
    // autoAdvance applies a SEEDED START_NEXT_HAND (reproducible redeal).
    expect(autoAdvance(room, { seed: 555 })).toBe(true);
    const next = room.gameState as TarneebState;
    expect(next.phase).toBe('bidding');
    expect(next.handNumber).toBe(s.handNumber + 1);
    expect(next.dealerSeat).toBe(nextSeatCounterClockwise(prevDealer)); // dealer moved right
  });

  it('the redeal is server-seeded: same seed → identical next hand', () => {
    const redealWith = (seed: number): TarneebState => {
      const room = botRoom(4);
      drive(room, { stopPhase: 'hand_complete' });
      autoAdvance(room, { seed });
      return room.gameState as TarneebState;
    };
    expect(redealWith(999).handsBySeat).toEqual(redealWith(999).handsBySeat);
  });

  it('a bot-only room reaches game_finished, and a finished game does NOT auto-advance', () => {
    const room = botRoom(31);
    let k = 3000;
    drive(room, { seedGen: () => ++k });
    const s = room.gameState as TarneebState;
    expect(def.isFinished(s)).toBe(true);
    expect(s.phase).toBe('game_finished');
    expect(s.winnerTeam === 'A' || s.winnerTeam === 'B').toBe(true);
    // The winning team is at/over target; teams are consistent with the seats.
    expect(s.scoresByTeam[s.winnerTeam!]).toBeGreaterThanOrEqual(s.targetScore);
    expect(teamOfSeat(0)).toBe('A');
    // Terminal state: no public screen, no advance.
    expect(publicScreenOf(room)).toBeNull();
    expect(autoAdvance(room, { seed: 1 })).toBe(false);
  });
});

// Type-only sanity: an ACTION_REQUEST payload for Tarneeb is a valid AnyGameAction
// (compile-time), so the wire union already carries it (no messages.ts change).
const _sampleAction: TarneebAction = { type: 'PASS_BID' };
void _sampleAction;
