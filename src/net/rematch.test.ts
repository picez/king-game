// Rematch / "Play again" server logic (Stage 25.9). Pure serverCore functions — no sockets, no
// DB. Verifies: a rematch is only offerable once finished, only humans' consent is required
// (bots are always ready), restart preserves the room/members/gameType, and the state resets.
import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, activePlayers,
  isRoomFinished, markRematchReady, removeRematchReady, clearRematch, rematchStateOf,
  allHumansReady, restartGame, rematchHumans, type ServerRoom,
} from './serverCore';
import type { GameState } from '../models/types';

/** A seated King room: host + 1 human + 1 bot (3 players — King's minimum). */
function kingRoom(): ServerRoom {
  const r = createRoom({
    code: 'RM', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, gameType: 'king', now: 1,
  });
  addMember(r, { clientId: 'bee', reconnectToken: 'bt', name: 'Bee' });
  addBot(r, 'host', { clientId: 'bot1', reconnectToken: 'rt' });
  return r;
}

/** Force the room's game into its finished screen (King → status game_finished). */
function finish(r: ServerRoom): void {
  startGame(r, { seed: 5, now: 2 });
  (r.gameState as GameState).status = 'game_finished';
}

describe('rematch — offer gating', () => {
  it('isRoomFinished is false in lobby / mid-game, true once finished', () => {
    const r = kingRoom();
    expect(isRoomFinished(r)).toBe(false);           // not started
    startGame(r, { seed: 5, now: 2 });
    expect(isRoomFinished(r)).toBe(false);           // playing
    (r.gameState as GameState).status = 'game_finished';
    expect(isRoomFinished(r)).toBe(true);
  });

  it('restartGame refuses before the game is finished', () => {
    const r = kingRoom();
    startGame(r, { seed: 5, now: 2 });
    expect(restartGame(r, { seed: 9, now: 3 }).ok).toBe(false);
  });
});

describe('rematch — readiness (bots always ready)', () => {
  it('needs every connected HUMAN; bots are never counted', () => {
    const r = kingRoom();
    finish(r);
    expect(rematchHumans(r).map((m) => m.clientId).sort()).toEqual(['bee', 'host']); // not bot1
    expect(rematchStateOf(r)).toEqual({ ready: [], needed: 2 });

    markRematchReady(r, 'bot1');                       // a bot cannot ready
    expect(rematchStateOf(r).ready).toEqual([]);

    markRematchReady(r, 'host');
    expect(rematchStateOf(r)).toEqual({ ready: ['host'], needed: 2 });
    expect(allHumansReady(r)).toBe(false);            // waiting for Bee

    markRematchReady(r, 'bee');
    expect(allHumansReady(r)).toBe(true);             // both humans ready
  });

  it('decline / clear drop readiness', () => {
    const r = kingRoom();
    finish(r);
    markRematchReady(r, 'host');
    markRematchReady(r, 'bee');
    removeRematchReady(r, 'host');
    expect(rematchStateOf(r).ready).toEqual(['bee']);
    expect(allHumansReady(r)).toBe(false);
    clearRematch(r);
    expect(rematchStateOf(r)).toEqual({ ready: [], needed: 2 });
  });
});

describe('rematch — restart preserves the room, resets the game', () => {
  it('restart keeps members/seats/gameType and deals a fresh (non-finished) game', () => {
    const r = kingRoom();
    const membersBefore = [...r.members.keys()];
    finish(r);
    markRematchReady(r, 'host'); markRematchReady(r, 'bee');
    expect(allHumansReady(r)).toBe(true);

    const res = restartGame(r, { seed: 9, now: 3 });
    expect(res.ok).toBe(true);
    expect(r.gameType).toBe('king');
    expect([...r.members.keys()]).toEqual(membersBefore);  // same seats/members/bot
    expect(activePlayers(r)).toHaveLength(3);
    expect(isRoomFinished(r)).toBe(false);                 // a fresh game, not finished
    expect(r.gameState).not.toBeNull();
    expect(r.rematchReady).toBeUndefined();                // rematch state cleared by restart
  });

  it('a single-human + bots room only needs that one human ready', () => {
    const r = createRoom({
      code: 'SOLO', playerCount: 3, modeSelectionType: 'fixed',
      host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, gameType: 'king', now: 1,
    });
    addBot(r, 'host', { clientId: 'b1', reconnectToken: 'r1' });
    addBot(r, 'host', { clientId: 'b2', reconnectToken: 'r2' });
    finish(r);
    expect(rematchStateOf(r).needed).toBe(1);
    markRematchReady(r, 'host');
    expect(allHumansReady(r)).toBe(true);                  // immediate restart path
  });
});
