import { describe, it, expect } from 'vitest';
import { gameReducer, getCurrentPlayer } from '../core/gameEngine';
import { getValidCards } from '../core/rules';
import type { GameState } from '../models/types';
import {
  seatToPlayerId, buildStartAction, authorizeAction, applyForward, firstConnectMessage,
  defaultServerUrl, isInsecureWsOnSecurePage, humanError, isJoinError,
} from './online';
import type { OnlineIntent } from './online';
import type { RoomSnapshot } from './messages';

function start4p(): GameState {
  // 4 players → no kitty, first mode is negative → status 'playing' immediately.
  const s = gameReducer(null, {
    type: 'START_GAME',
    playerNames: ['A', 'B', 'C', 'D'],
    playerTypes: ['human', 'human', 'human', 'human'],
    modeSelectionType: 'fixed',
  });
  if (!s) throw new Error('no state');
  return s;
}

describe('seatToPlayerId', () => {
  it('maps a seat index to the engine player id', () => {
    expect(seatToPlayerId(0)).toBe('player-0');
    expect(seatToPlayerId(3)).toBe('player-3');
  });
});

describe('firstConnectMessage', () => {
  it('maps a create intent to a single CREATE_ROOM message', () => {
    const intent: OnlineIntent = { kind: 'create', name: 'Alice', playerCount: 3, modeSelectionType: 'dealer_choice' };
    expect(firstConnectMessage(intent)).toEqual({
      t: 'CREATE_ROOM', name: 'Alice', playerCount: 3, modeSelectionType: 'dealer_choice',
    });
  });

  it('maps a join intent to a single JOIN_ROOM message', () => {
    const intent: OnlineIntent = { kind: 'join', code: 'KQJ7', name: 'Bob' };
    expect(firstConnectMessage(intent)).toEqual({ t: 'JOIN_ROOM', code: 'KQJ7', name: 'Bob' });
  });

  it('maps a resume intent to a RECONNECT message', () => {
    const intent: OnlineIntent = { kind: 'resume', code: 'KQJ7', reconnectToken: 'tok-9', name: 'Bob' };
    expect(firstConnectMessage(intent)).toEqual({ t: 'RECONNECT', code: 'KQJ7', reconnectToken: 'tok-9' });
  });

  it('is pure — repeated calls produce equal messages, never a second side effect', () => {
    const intent: OnlineIntent = { kind: 'create', name: 'A', playerCount: 4, modeSelectionType: 'fixed' };
    expect(firstConnectMessage(intent)).toEqual(firstConnectMessage(intent));
  });

  it('includes the password when creating/joining a protected room', () => {
    expect(firstConnectMessage({ kind: 'create', name: 'A', playerCount: 4, modeSelectionType: 'fixed', password: 's3cret' }))
      .toEqual({ t: 'CREATE_ROOM', name: 'A', playerCount: 4, modeSelectionType: 'fixed', password: 's3cret' });
    expect(firstConnectMessage({ kind: 'join', code: 'KQJ7', name: 'B', password: 's3cret' }))
      .toEqual({ t: 'JOIN_ROOM', code: 'KQJ7', name: 'B', password: 's3cret' });
  });

  it('omits password when none is given (open room)', () => {
    expect(firstConnectMessage({ kind: 'join', code: 'KQJ7', name: 'B' }))
      .toEqual({ t: 'JOIN_ROOM', code: 'KQJ7', name: 'B' });
  });
});

describe('humanError', () => {
  it('maps known join error codes to readable text', () => {
    expect(humanError('BAD_PASSWORD')).toBe('Wrong room password');
    expect(humanError('ROOM_FULL')).toBe('Room is full');
    expect(humanError('ROOM_NOT_FOUND')).toBe('Room not found');
    expect(humanError('GAME_ALREADY_STARTED')).toBe('Game already started');
    expect(humanError('NAME_TAKEN')).toBe('This name is already used in this room. Please choose another name.');
  });

  it('falls back to a generic message for unknown/other codes', () => {
    expect(humanError('NOT_YOUR_TURN')).toBe('Could not join room');
    expect(humanError(null)).toBe('Could not join room');
    expect(humanError(undefined)).toBe('Could not join room');
  });

  it('isJoinError distinguishes join rejections from connection/other errors', () => {
    expect(isJoinError('BAD_PASSWORD')).toBe(true);
    expect(isJoinError('ROOM_FULL')).toBe(true);
    expect(isJoinError('GAME_ALREADY_STARTED')).toBe(true);
    expect(isJoinError('NOT_YOUR_TURN')).toBe(false);
    expect(isJoinError(null)).toBe(false);
  });
});

describe('defaultServerUrl', () => {
  it('uses wss://<host>/ws on an HTTPS page (never insecure ws://)', () => {
    expect(defaultServerUrl({ protocol: 'https:', hostname: 'king.example.com' }))
      .toBe('wss://king.example.com/ws');
  });

  it('uses ws://<host>:3001/ws on an HTTP/LAN page', () => {
    expect(defaultServerUrl({ protocol: 'http:', hostname: '192.168.1.20' }))
      .toBe('ws://192.168.1.20:3001/ws');
  });

  it('honours an explicit env URL over everything', () => {
    expect(defaultServerUrl({ protocol: 'https:', hostname: 'x' }, 'wss://my-app.onrender.com/ws'))
      .toBe('wss://my-app.onrender.com/ws');
  });

  it('falls back to localhost when there is no page location', () => {
    expect(defaultServerUrl(null)).toBe('ws://localhost:3001/ws');
  });
});

describe('isInsecureWsOnSecurePage', () => {
  it('flags ws:// on an HTTPS page (mixed content)', () => {
    expect(isInsecureWsOnSecurePage('ws://host:3001', { protocol: 'https:', hostname: 'h' })).toBe(true);
  });
  it('allows wss:// on an HTTPS page', () => {
    expect(isInsecureWsOnSecurePage('wss://host', { protocol: 'https:', hostname: 'h' })).toBe(false);
  });
  it('allows ws:// on an HTTP page (LAN/dev)', () => {
    expect(isInsecureWsOnSecurePage('ws://host:3001', { protocol: 'http:', hostname: 'h' })).toBe(false);
  });
});

describe('buildStartAction', () => {
  it('builds START_GAME from seated players in seat order, all human', () => {
    const room: RoomSnapshot = {
      code: 'KQJ7',
      playerCount: 3,
      modeSelectionType: 'dealer_choice',
      started: true,
      hasPassword: false,
      members: [
        { clientId: 'c2', name: 'Bob',   role: 'player',    seatIndex: 1, isHost: false, connected: true, type: 'human' },
        { clientId: 'c1', name: 'Alice', role: 'player',    seatIndex: 0, isHost: true,  connected: true, type: 'human' },
        { clientId: 'c3', name: 'Cara',  role: 'player',    seatIndex: 2, isHost: false, connected: true, type: 'human' },
        { clientId: 'c4', name: 'Watch', role: 'spectator', seatIndex: null, isHost: false, connected: true, type: 'human' },
      ],
    };
    const action = buildStartAction(room);
    expect(action).toEqual({
      type: 'START_GAME',
      playerNames: ['Alice', 'Bob', 'Cara'], // seat order, spectator excluded
      playerTypes: ['human', 'human', 'human'],
      modeSelectionType: 'dealer_choice',
    });
  });

  it('marks bot seats as type ai in seat order (2 humans + 1 bot)', () => {
    const room: RoomSnapshot = {
      code: 'BOT1', playerCount: 3, modeSelectionType: 'dealer_choice', started: true, hasPassword: false,
      members: [
        { clientId: 'h1', name: 'Alice', role: 'player', seatIndex: 0, isHost: true,  connected: true, type: 'human' },
        { clientId: 'b1', name: 'Bot 1', role: 'player', seatIndex: 2, isHost: false, connected: true, type: 'ai' },
        { clientId: 'h2', name: 'Bob',   role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'human' },
      ],
    };
    const action = buildStartAction(room);
    expect(action).toEqual({
      type: 'START_GAME',
      playerNames: ['Alice', 'Bob', 'Bot 1'],
      playerTypes: ['human', 'human', 'ai'], // seat 2 is the bot
      modeSelectionType: 'dealer_choice',
    });
  });
});

describe('authorizeAction', () => {
  it('allows PLAY_CARD only from the seat that owns the action', () => {
    const state = start4p();
    const turnId = getCurrentPlayer(state).id; // e.g. player-1
    const turnSeat = Number(turnId.split('-')[1]);
    const card = getValidCards(getCurrentPlayer(state).hand, null)[0];

    expect(authorizeAction(state, { type: 'PLAY_CARD', playerId: turnId, card }, turnSeat)).toBe(true);
    // Wrong seat claiming someone else's id
    const otherSeat = (turnSeat + 1) % 4;
    expect(authorizeAction(state, { type: 'PLAY_CARD', playerId: turnId, card }, otherSeat)).toBe(false);
    // Spectator
    expect(authorizeAction(state, { type: 'PLAY_CARD', playerId: turnId, card }, null)).toBe(false);
  });

  it('allows setup actions only from the dealer seat', () => {
    const state = start4p();
    const dealerId = state.players[state.dealerIndex].id;
    const dealerSeat = Number(dealerId.split('-')[1]);
    const nonDealerSeat = (dealerSeat + 1) % 4;

    expect(authorizeAction(state, { type: 'SELECT_TRUMP', suit: 'hearts' }, dealerSeat)).toBe(true);
    expect(authorizeAction(state, { type: 'SELECT_TRUMP', suit: 'hearts' }, nonDealerSeat)).toBe(false);
  });

  it('allows SURRENDER_ROUND only for the sender\'s own seat', () => {
    const state = start4p();
    expect(authorizeAction(state, { type: 'SURRENDER_ROUND', playerId: 'player-2' }, 2)).toBe(true);
    // Cannot concede on behalf of another seat.
    expect(authorizeAction(state, { type: 'SURRENDER_ROUND', playerId: 'player-3' }, 2)).toBe(false);
    expect(authorizeAction(state, { type: 'SURRENDER_ROUND', playerId: 'player-2' }, null)).toBe(false);
  });

  it('never accepts host-internal actions from a client', () => {
    const state = start4p();
    expect(authorizeAction(state, { type: 'NEXT_TRICK' }, 0)).toBe(false);
    expect(authorizeAction(state, { type: 'NEXT_ROUND' }, 0)).toBe(false);
  });
});

describe('applyForward', () => {
  it('applies an authorised PLAY_CARD and rejects an unauthorised one', () => {
    const state = start4p();
    const turnId = getCurrentPlayer(state).id;
    const turnSeat = Number(turnId.split('-')[1]);
    const card = getValidCards(getCurrentPlayer(state).hand, null)[0];

    const ok = applyForward(state, { type: 'PLAY_CARD', playerId: turnId, card }, turnSeat)!;
    expect(ok.currentTrick?.plays).toHaveLength(1);

    // Wrong seat → unchanged state (reference equality).
    const wrongSeat = (turnSeat + 1) % 4;
    const rejected = applyForward(state, { type: 'PLAY_CARD', playerId: turnId, card }, wrongSeat);
    expect(rejected).toBe(state);

    // Host-internal action from a client → unchanged.
    expect(applyForward(state, { type: 'NEXT_TRICK' }, turnSeat)).toBe(state);
  });
});
