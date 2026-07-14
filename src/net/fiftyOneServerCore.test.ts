// ---------------------------------------------------------------------------
// 51 online seam (Stage 30.4 readiness). Drives 51 through the SAME server-
// authoritative functions the WS layer uses (startGame / applyActionRequest /
// applyBotTurn / applyTimeoutAction / autoAdvance / publicScreenOf /
// sanitizedStateFor / serialize+deserialize) to prove the definition is
// online-ready: turn ownership is authorised generically, illegal moves are
// rejected as reducer no-ops, the public between-rounds screen advances under a
// server seed, redaction leaks nothing, and the state round-trips through
// persistence.
//
// 51 is NOT hostable online: GAME_CATALOG['fifty-one'].supportsOnline = false, so
// wsHandlers rejects CREATE_ROOM (see fiftyOne/localGating.test.ts). This file
// exercises serverCore directly — exactly as Preferans/Tarneeb were before their
// releases — WITHOUT enabling online 51. Mirrors preferansServerCore.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, applyActionRequest, applyBotTurn,
  applyTimeoutAction, autoAdvance, publicScreenOf, actingMember, roomSummary,
  snapshot, sanitizedStateFor, serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import { GAME_CATALOG } from '../games/catalog';
import type { AnyGameAction } from '../games/anyGame';
import type { FiftyOneState } from '../games/fiftyOne/types';

const def = getGameDefinition('fifty-one')!;
const asF = (s: unknown) => s as unknown as FiftyOneState;
/** The 51 reducer/bot are `any`-typed at the registry boundary; wrap the bot move
 *  so it satisfies the AnyGameAction param without widening the union. */
const bot = (s: FiftyOneState): AnyGameAction => def.botAction(s) as AnyGameAction;

/** A started N-player bot room (host seat 0 human + bots). Internal only — 51 is
 *  NOT hostable online from the UI; this exercises serverCore. */
function botRoom(playerCount: 2 | 3 | 4, seed: number): ServerRoom {
  const room = createRoom({
    code: '51AB', gameType: 'fifty-one', playerCount, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, now: 1,
  });
  for (let i = 1; i < playerCount; i++) addBot(room, 'host', { clientId: `bot-${i}`, reconnectToken: `bt-${i}` });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  return room;
}

/** A started all-human room, addressable by seat (to test authorization). */
function seatedRoom(playerCount: 2 | 3 | 4, seed: number): { room: ServerRoom; clientForSeat: (seat: number) => string } {
  const room = createRoom({
    code: '51HU', gameType: 'fifty-one', playerCount, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
  });
  for (let i = 1; i < playerCount; i++) addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}` });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  const clientForSeat = (seat: number) => {
    for (const [cid, m] of room.members) if (m.seatIndex === seat) return cid;
    throw new Error(`no client at seat ${seat}`);
  };
  return { room, clientForSeat };
}

const actingSeat = (room: ServerRoom): number | null => {
  const id = def.getActingPlayerId(asF(room.gameState));
  return id ? Number(id.split('-')[1]) : null;
};

/**
 * Drive the acting seat's legal heuristic move through the AUTHORISED path,
 * auto-advancing the public `round_complete` screen via the seeded autoAdvance.
 * Every action (incl. bot draws that may reshuffle the pile) is threaded with a
 * deterministic per-step seed so the whole drive is reproducible.
 */
function drive(room: ServerRoom, opts: { stopPhase?: FiftyOneState['phase']; cap?: number; seedBase?: number } = {}): void {
  let guard = 0;
  const cap = opts.cap ?? 60_000;
  const seedBase = opts.seedBase ?? 7000;
  while (guard++ < cap) {
    const s = asF(room.gameState);
    if (def.isFinished(s)) break;
    if (opts.stopPhase && s.phase === opts.stopPhase) break;
    if (s.phase === 'round_complete') { autoAdvance(room, { seed: seedBase + guard }); continue; }
    const m = actingMember(room);
    if (!m) break;
    const ok = applyActionRequest(room, m.clientId, bot(s), { seed: seedBase + guard }).ok;
    expect(ok, `stalled at step ${guard} (phase ${s.phase}, step ${s.turnStep})`).toBe(true);
  }
}

describe('serverCore runs 51 internally (Stage 30.4 readiness)', () => {
  it('51 stays gated OFF online — the catalog forbids hosting it', () => {
    expect(GAME_CATALOG['fifty-one'].supportsOnline).toBe(false);
    expect(def.recordsStats).toBe(false);
  });

  it('createRoom(gameType:fifty-one) + startGame builds a FiftyOneState (13/14 deal)', () => {
    const room = botRoom(3, 7);
    expect(room.gameType).toBe('fifty-one');
    const s = asF(room.gameState);
    expect(s.gameType).toBe('fifty-one');
    expect(s.phase).toBe('playing');
    expect(s.players).toHaveLength(3);
    // The starter holds 14, every other active seat 13 (§4).
    expect(s.handsBySeat[s.starterSeat]).toHaveLength(14);
    for (let seat = 0; seat < 3; seat++) if (seat !== s.starterSeat) expect(s.handsBySeat[seat]).toHaveLength(13);
    // The starter opens by discarding first → begins at meld_discard, no draw (§4).
    expect(s.currentSeat).toBe(s.starterSeat);
    expect(s.turnStep).toBe('meld_discard');
    expect(s.discardPile).toHaveLength(0);
  });

  it('sanitizedStateFor shows the viewer their own hand, hides opponents + draw pile; no id leaks', () => {
    const room = botRoom(4, 11);
    const real = asF(room.gameState);
    const before = JSON.stringify(real);
    const view = asF(sanitizedStateFor(room, 'host')); // host = seat 0
    expect(view.handsBySeat[0]).toEqual(real.handsBySeat[0]);   // own hand real
    const json = JSON.stringify(view);
    for (const seat of [1, 2, 3]) {
      expect(view.handsBySeat[seat]).toHaveLength(real.handsBySeat[seat].length); // count kept
      expect(view.handsBySeat[seat].every((cd) => cd.id === 'hidden' && cd.suit === null && cd.rank === null)).toBe(true);
      for (const cd of real.handsBySeat[seat]) expect(json.includes(cd.id), `leaked seat ${seat} ${cd.id}`).toBe(false);
    }
    // The draw pile order/contents are hidden from everyone (count kept).
    expect(view.drawPile).toHaveLength(real.drawPile.length);
    expect(view.drawPile.every((cd) => cd.id === 'hidden')).toBe(true);
    for (const cd of real.drawPile) expect(json.includes(cd.id), `leaked draw ${cd.id}`).toBe(false);
    // Public fields survive redaction untouched.
    expect(view.discardPile).toEqual(real.discardPile);
    expect(view.publicMelds).toEqual(real.publicMelds);
    expect(view.scoresBySeat).toEqual(real.scoresBySeat);
    expect(view.openedBySeat).toEqual(real.openedBySeat);
    expect(view.currentSeat).toBe(real.currentSeat);
    // Redaction must NOT mutate the authoritative state.
    expect(JSON.stringify(room.gameState)).toBe(before);
  });

  it('a spectator (unknown client → seat null) sees no real hand', () => {
    const room = botRoom(3, 3);
    const spectator = asF(sanitizedStateFor(room, 'nobody'));
    for (const hand of spectator.handsBySeat) expect(hand.every((cd) => cd.id === 'hidden')).toBe(true);
    expect(spectator.drawPile.every((cd) => cd.id === 'hidden')).toBe(true);
  });

  it('authorises only the acting seat: a foreign-player action is rejected NOT_YOUR_TURN', () => {
    const { room, clientForSeat } = seatedRoom(3, 9);
    const actor = actingSeat(room)!;
    const other = (actor + 1) % 3;
    // Any action from a non-acting seat is refused before the reducer runs.
    const bad = applyActionRequest(room, clientForSeat(other), { type: 'DRAW_FROM_DECK' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('NOT_YOUR_TURN');
    // The acting seat's legal heuristic move is accepted and mutates the state.
    const before = JSON.stringify(room.gameState);
    const good = applyActionRequest(room, clientForSeat(actor), bot(asF(room.gameState)));
    expect(good.ok).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before);
  });

  it('rejects an illegal action from the acting seat as a reducer no-op (ILLEGAL_ACTION)', () => {
    const { room, clientForSeat } = seatedRoom(3, 15);
    const actor = actingSeat(room)!;
    // The starter begins at 'meld_discard' (holds 14), so DRAW_FROM_DECK is illegal
    // (turnStep must be 'draw') → reducer returns the same reference → rejected.
    expect(asF(room.gameState).turnStep).toBe('meld_discard');
    const before = JSON.stringify(room.gameState);
    const bad = applyActionRequest(room, clientForSeat(actor), { type: 'DRAW_FROM_DECK' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('ILLEGAL_ACTION');
    expect(JSON.stringify(room.gameState)).toBe(before); // state untouched
  });

  it('a normal turn is draw→discard: TAKE_DISCARD before opening is rejected, DRAW_FROM_DECK is legal', () => {
    const { room, clientForSeat } = seatedRoom(2, 21);
    // Play the starter's opening discard so seat rotates to a fresh 'draw' step.
    const starter = actingSeat(room)!;
    applyActionRequest(room, clientForSeat(starter), bot(asF(room.gameState)), { seed: 1 });
    const s = asF(room.gameState);
    expect(s.turnStep).toBe('draw');
    const drawer = s.currentSeat;
    // Not opened yet → the discard pile is off-limits (§5).
    const bad = applyActionRequest(room, clientForSeat(drawer), { type: 'TAKE_DISCARD' });
    expect(bad.ok).toBe(false);
    // Drawing from the deck is the legal way to start the turn.
    const good = applyActionRequest(room, clientForSeat(drawer), { type: 'DRAW_FROM_DECK' }, { seed: 2 });
    expect(good.ok).toBe(true);
    expect(asF(room.gameState).turnStep).toBe('meld_discard');
  });

  it('applyBotTurn progresses a bot; applyTimeoutAction auto-plays for a human actor', () => {
    const botR = botRoom(3, 13);
    // Advance the human (seat 0) until a bot is the actor, then let the bot move.
    let guard = 0;
    while (guard++ < 30 && actingMember(botR)?.type === 'human') {
      const m = actingMember(botR)!;
      applyActionRequest(botR, m.clientId, bot(asF(botR.gameState)), { seed: 100 + guard });
    }
    expect(actingMember(botR)?.type).toBe('ai');
    const before = JSON.stringify(botR.gameState);
    expect(applyBotTurn(botR).acted).toBe(true);
    expect(JSON.stringify(botR.gameState)).not.toBe(before);

    const { room } = seatedRoom(3, 8);
    expect(actingMember(room)?.type).toBe('human');
    const before2 = JSON.stringify(room.gameState);
    expect(applyTimeoutAction(room).acted).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before2);
  });

  it('serialize → deserialize preserves the 51 game mid-play; redaction still works', () => {
    const { room } = seatedRoom(3, 21);
    // Play a handful of turns so hands/draw/discard/melds/scores are all populated.
    for (let i = 0; i < 12 && !def.isFinished(room.gameState!); i++) {
      if (asF(room.gameState).phase === 'round_complete') { autoAdvance(room, { seed: 500 + i }); continue; }
      const m = actingMember(room);
      if (!m) break;
      applyActionRequest(room, m.clientId, bot(asF(room.gameState)), { seed: 200 + i });
    }
    const beforeState = asF(room.gameState);
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.gameType).toBe('fifty-one');
    const after = asF(restored.gameState);
    for (const k of ['phase', 'dealerSeat', 'starterSeat', 'currentSeat', 'turnStep', 'roundNumber'] as const) {
      expect(after[k], `restore preserves ${k}`).toEqual(beforeState[k]);
    }
    expect(after.handsBySeat).toEqual(beforeState.handsBySeat);
    expect(after.drawPile).toEqual(beforeState.drawPile);
    expect(after.discardPile).toEqual(beforeState.discardPile);
    expect(after.publicMelds).toEqual(beforeState.publicMelds);
    expect(after.scoresBySeat).toEqual(beforeState.scoresBySeat);
    expect(after.openedBySeat).toEqual(beforeState.openedBySeat);
    // Redaction after restore still hides opponents for the seat-0 viewer.
    const view = asF(sanitizedStateFor(restored, 'c0'));
    expect(view.handsBySeat[0].every((cd) => cd.id !== 'hidden')).toBe(true);
    for (const seat of [1, 2]) expect(view.handsBySeat[seat].every((cd) => cd.id === 'hidden')).toBe(true);
  });

  it('the public RoomSummary / snapshot never carry the game state or the hidden draw pile', () => {
    const room = botRoom(4, 33);
    const drawIds = asF(room.gameState).drawPile.map((cd) => cd.id);
    const summary = roomSummary(room);
    const snap = snapshot(room);
    expect('gameState' in summary).toBe(false);
    expect('gameState' in snap).toBe(false);
    const summaryJson = JSON.stringify(summary);
    const snapJson = JSON.stringify(snap);
    for (const id of drawIds) {
      expect(summaryJson.includes(id), `summary leaked draw ${id}`).toBe(false);
      expect(snapJson.includes(id), `snapshot leaked draw ${id}`).toBe(false);
    }
    expect(summary.gameType).toBe('fifty-one');
  });
});

describe('51 public round_complete advances server-side (Stage 30.4)', () => {
  it('round_complete is a public round_scoring screen that autoAdvance seeds to the next round', () => {
    const room = botRoom(3, 4);
    drive(room, { stopPhase: 'round_complete' });
    const s = asF(room.gameState);
    expect(s.phase).toBe('round_complete');
    expect(def.isFinished(s)).toBe(false);
    // No seat acts on this screen → the room reports the generic round_scoring pause.
    expect(actingMember(room)).toBeNull();
    expect(publicScreenOf(room)).toBe('round_scoring');
    const prevRound = s.roundNumber;
    expect(autoAdvance(room, { seed: 555 })).toBe(true);
    const next = asF(room.gameState);
    expect(next.phase).toBe('playing');
    expect(next.roundNumber).toBe(prevRound + 1);
  });

  it('the redeal is server-seeded: same round_complete + same seed → identical next deal', () => {
    const room = botRoom(3, 4);
    drive(room, { stopPhase: 'round_complete' });
    // Clone the exact round_complete room twice; advancing each with the same seed
    // must produce byte-identical deals (reproducible / auditable redeal).
    const a = deserializeRoom(serializeRoom(room))!;
    const b = deserializeRoom(serializeRoom(room))!;
    autoAdvance(a, { seed: 999 });
    autoAdvance(b, { seed: 999 });
    expect(asF(a.gameState).handsBySeat).toEqual(asF(b.gameState).handsBySeat);
    expect(asF(a.gameState).drawPile).toEqual(asF(b.gameState).drawPile);
  });

  it('sustains the online loop across multiple rounds: roundNumber climbs and penalties accumulate', () => {
    // Drive several rounds through the authorised action + seeded autoAdvance path.
    // (A full 510-point match is many rounds; reaching round 3 already proves the
    // draw→meld→discard→score→redeal loop sustains server-side without stalling.)
    const room = botRoom(3, 4);
    let guard = 0;
    while (guard++ < 40_000) {
      const s = asF(room.gameState);
      if (def.isFinished(s) || s.roundNumber >= 3) break;
      if (s.phase === 'round_complete') { autoAdvance(room, { seed: 3000 + guard }); continue; }
      const m = actingMember(room);
      if (!m) break;
      expect(applyActionRequest(room, m.clientId, bot(s), { seed: 3000 + guard }).ok).toBe(true);
    }
    const s = asF(room.gameState);
    expect(s.roundNumber >= 3 || def.isFinished(s)).toBe(true);
    // At least one non-winning seat has taken a running penalty by now (§11).
    expect(s.scoresBySeat.some((v) => v > 0)).toBe(true);
  }, 30_000);

  it('a finished game reports no public screen and does NOT auto-advance', () => {
    // Build a terminal state directly (a full 510-point drive is unnecessary for
    // the invariant): once game_finished, the room exposes no between-rounds pause
    // and autoAdvance is a no-op, so the server never re-deals a decided match.
    const room = botRoom(3, 4);
    const finished = { ...asF(room.gameState), phase: 'game_finished', winnerSeat: 0, eliminatedSeats: [false, true, true] };
    room.gameState = finished as unknown as ServerRoom['gameState'];
    expect(def.isFinished(asF(room.gameState))).toBe(true);
    expect(publicScreenOf(room)).toBeNull();
    expect(autoAdvance(room, { seed: 1 })).toBe(false);
    // actingMember is null on a finished game (no seat acts).
    expect(actingMember(room)).toBeNull();
  });
});
