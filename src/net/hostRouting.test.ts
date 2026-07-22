// ---------------------------------------------------------------------------
// Host create-intent routing (Stage 37.6). Regression for the confirmed FAIL where
// selecting Poker in the Host picker created a KING room: `StartMenu.host()` added the
// `gameType` only through per-game conditional spreads (durak/deberc/tarneeb/preferans/
// fifty-one) and had NO branch for Poker (or King), so `CREATE_ROOM` went out without a
// `gameType` and the server applied its legacy `?? 'king'` default. These behavior tests
// follow the exact broken path — picker choice → create-intent → CREATE_ROOM message →
// authoritative room → started state — and a matrix over all 7 picker values so no
// future game can silently fall back to King again.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCreateIntent, firstConnectMessage } from './online';
import { createRoom, addBot, startGame, snapshot } from './serverCore';
import { getGameDefinition } from '../games/registry';
import { pokerGameDefinition } from '../games/poker/definition';
import { pokerReducer } from '../games/poker/engine';
import type { GameType } from '../games/catalog';
import type { PokerState } from '../games/poker/types';

const ALL_GAMES: GameType[] = ['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one', 'poker'];

/** The server's exact CREATE_ROOM game-type resolution (wsHandlers): `msg.gameType ?? 'king'`. */
function serverGameType(msg: { gameType?: GameType }): GameType {
  return msg.gameType ?? 'king';
}

describe('picking Poker creates a POKER room, not a King room (Stage 37.6)', () => {
  it('the create-intent carries gameType: poker', () => {
    const intent = buildCreateIntent({ gameType: 'poker', name: 'Alice', modeSelectionType: 'fixed', avatar: '🐱' });
    expect(intent).toMatchObject({ kind: 'create', gameType: 'poker', name: 'Alice' });
  });

  it('firstConnectMessage forwards gameType: poker into CREATE_ROOM', () => {
    const intent = buildCreateIntent({ gameType: 'poker', name: 'Alice', modeSelectionType: 'fixed' });
    const msg = firstConnectMessage(intent);
    expect(msg).toMatchObject({ t: 'CREATE_ROOM', gameType: 'poker' });
  });

  it('the server resolves the CREATE_ROOM to a poker room (never the ?? king default)', () => {
    const msg = firstConnectMessage(buildCreateIntent({ gameType: 'poker', name: 'A', modeSelectionType: 'fixed' })) as { t: 'CREATE_ROOM'; gameType?: GameType };
    expect(serverGameType(msg)).toBe('poker'); // the exact fallback the bug hit → now 'poker'
    const room = createRoom({
      code: 'PKR1', gameType: serverGameType(msg), playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'A' }, now: 0,
    });
    expect(room.gameType).toBe('poker');
    expect(snapshot(room).gameType).toBe('poker');
  });

  it('START_GAME on that room builds an authoritative PokerState, not a King GameState', () => {
    const room = createRoom({
      code: 'PKR2', gameType: 'poker', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'A' }, now: 0,
    });
    addBot(room, 'c0', { clientId: 'b1', reconnectToken: 'tb1' });
    expect(startGame(room, { seed: 7, now: 0 }).ok).toBe(true);

    const state = room.gameState as unknown as PokerState;
    // Poker-specific authoritative shape.
    expect(state.gameType).toBe('poker');
    expect(state.phase).toBe('betting');
    expect(Array.isArray(state.stacksBySeat)).toBe(true);
    expect(Array.isArray(state.holeCardsBySeat)).toBe(true);
    expect(state.holeCardsBySeat[0]).toHaveLength(2);       // 2 hole cards each
    expect(state.committedBySeat.some((c) => c > 0)).toBe(true); // blinds posted
    expect(state.options).toMatchObject({ startingStack: 1000, smallBlind: 10, bigBlind: 20 });
    // NOT a King GameState.
    expect('status' in (state as object)).toBe(false);
    expect('currentRound' in (state as object)).toBe(false);
    expect('dealerIndex' in (state as object)).toBe(false);
    // The room routes through the POKER definition + reducer.
    expect(getGameDefinition('poker')).toBe(pokerGameDefinition);
    expect(pokerGameDefinition.reducer).toBe(pokerReducer);
  });
});

describe('Host create-intent matrix — every picker value routes to its own game (Stage 37.6)', () => {
  for (const game of ALL_GAMES) {
    it(`${game} → gameType ${game} (never falls back to King)`, () => {
      const intent = buildCreateIntent({ gameType: game, name: 'A', modeSelectionType: 'fixed' });
      expect(intent.gameType, `${game} intent`).toBe(game);
      const msg = firstConnectMessage(intent) as { gameType?: GameType };
      expect(msg.gameType, `${game} CREATE_ROOM`).toBe(game);
      // The server's resolution must equal the picked game for ALL 7 — the guard that
      // stops a new game from silently becoming King via a missing spread.
      expect(serverGameType(msg), `${game} server resolve`).toBe(game);
    });
  }

  it('the game-specific OPTIONS still ride along only for their own game', () => {
    const durak = buildCreateIntent({ gameType: 'durak', name: 'A', modeSelectionType: 'fixed', durakVariant: 'transfer' });
    expect(durak).toMatchObject({ gameType: 'durak', variant: 'transfer' });
    const deberc = buildCreateIntent({ gameType: 'deberc', name: 'A', modeSelectionType: 'fixed', debercMatchSize: 'big', debercPlayers: 4 });
    expect(deberc).toMatchObject({ gameType: 'deberc', matchSize: 'big', playerCount: 4 });
    const tarneeb = buildCreateIntent({ gameType: 'tarneeb', name: 'A', modeSelectionType: 'fixed', tarneebVariant: 'solo', tarneebTargetScore: 61 });
    expect(tarneeb).toMatchObject({ gameType: 'tarneeb', tarneebVariant: 'solo', tarneebTargetScore: 61 });
    const fiftyOne = buildCreateIntent({ gameType: 'fifty-one', name: 'A', modeSelectionType: 'fixed', fiftyOneEliminationScore: 310 });
    expect(fiftyOne).toMatchObject({ gameType: 'fifty-one', fiftyOneEliminationScore: 310 });
    // Poker carries no extra options — just its gameType.
    const poker = buildCreateIntent({ gameType: 'poker', name: 'A', modeSelectionType: 'fixed' });
    expect(poker.gameType).toBe('poker');
    expect(poker).not.toHaveProperty('variant');
    expect(poker).not.toHaveProperty('fiftyOneEliminationScore');
  });

  it('an optional timer/password ride along; otherwise they are omitted', () => {
    const timed = buildCreateIntent({ gameType: 'poker', name: 'A', modeSelectionType: 'fixed', turnTimerSec: 30, password: 's3cret' });
    expect(timed).toMatchObject({ gameType: 'poker', turnTimerSec: 30, password: 's3cret' });
    const bare = buildCreateIntent({ gameType: 'poker', name: 'A', modeSelectionType: 'fixed', turnTimerSec: 0 });
    expect(bare).not.toHaveProperty('turnTimerSec'); // 0 = off → omitted
    expect(bare).not.toHaveProperty('password');
  });
});

describe('Host + routing wiring guards (Stage 37.6)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('StartMenu.host() builds the intent via the shared pure builder (no per-game gameType spread)', () => {
    const src = read('src/ui/StartMenu.tsx');
    expect(src).toContain('buildCreateIntent(');
    // The brittle per-game `gameType: '<game>' as const` spreads must be gone.
    expect(src).not.toMatch(/gameType: 'durak' as const/);
    expect(src).not.toMatch(/gameType: 'fifty-one' as const/);
  });

  it('OnlineGame routes a poker room to PokerOnlineGame (not King GameRouter)', () => {
    const src = read('src/ui/online/OnlineGame.tsx');
    expect(src).toContain("net.room?.gameType === 'poker'");
    expect(src).toContain('PokerOnlineGame');
  });
});
