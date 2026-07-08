import { describe, it, expect } from 'vitest';
import { filterRooms, sortRooms, countRoomsByGame } from './roomBrowser';
import type { RoomSummary } from '../../net/messages';
import type { GameType } from '../../games/catalog';

let seq = 0;
function mk(over: Partial<RoomSummary> & { gameType: GameType }): RoomSummary {
  return {
    code: `R${seq++}`, hostName: 'H', hostAvatar: '🦊', hostConnected: true,
    playerCount: 4, occupiedSeats: 1, hasPassword: false,
    status: 'lobby', updatedAt: 1000, ...over,
  } as RoomSummary;
}

describe('filterRooms', () => {
  const rooms = [mk({ gameType: 'king' }), mk({ gameType: 'durak' }), mk({ gameType: 'king' }), mk({ gameType: 'tarneeb' })];

  it("'all' returns every room (a copy, not the same array)", () => {
    const out = filterRooms(rooms, 'all');
    expect(out).toHaveLength(4);
    expect(out).not.toBe(rooms);
  });

  it('filters to a single game', () => {
    expect(filterRooms(rooms, 'king').every((r) => r.gameType === 'king')).toBe(true);
    expect(filterRooms(rooms, 'king')).toHaveLength(2);
    expect(filterRooms(rooms, 'durak')).toHaveLength(1);
    expect(filterRooms(rooms, 'deberc')).toHaveLength(0);
  });
});

describe('sortRooms', () => {
  it("open-first: lobby before full before in_game", () => {
    const rooms = [
      mk({ gameType: 'king', status: 'in_game', code: 'IG' }),
      mk({ gameType: 'king', status: 'full', code: 'FU' }),
      mk({ gameType: 'king', status: 'lobby', code: 'LO' }),
    ];
    expect(sortRooms(rooms, 'open').map((r) => r.code)).toEqual(['LO', 'FU', 'IG']);
  });

  it('players: highest occupied first', () => {
    const rooms = [
      mk({ gameType: 'king', occupiedSeats: 1, code: 'A' }),
      mk({ gameType: 'king', occupiedSeats: 3, code: 'B' }),
      mk({ gameType: 'king', occupiedSeats: 2, code: 'C' }),
    ];
    expect(sortRooms(rooms, 'players').map((r) => r.code)).toEqual(['B', 'C', 'A']);
  });

  it('connection: connected hosts first', () => {
    const rooms = [
      mk({ gameType: 'king', hostConnected: false, code: 'OFF' }),
      mk({ gameType: 'king', hostConnected: true, code: 'ON' }),
    ];
    expect(sortRooms(rooms, 'connection').map((r) => r.code)).toEqual(['ON', 'OFF']);
  });

  it('recent: newest updatedAt first', () => {
    const rooms = [
      mk({ gameType: 'king', updatedAt: 100, code: 'OLD' }),
      mk({ gameType: 'king', updatedAt: 900, code: 'NEW' }),
    ];
    expect(sortRooms(rooms, 'recent').map((r) => r.code)).toEqual(['NEW', 'OLD']);
  });

  it('ties fall back to most-recent within a group', () => {
    const rooms = [
      mk({ gameType: 'king', status: 'lobby', updatedAt: 100, code: 'L1' }),
      mk({ gameType: 'king', status: 'lobby', updatedAt: 800, code: 'L2' }),
    ];
    expect(sortRooms(rooms, 'open').map((r) => r.code)).toEqual(['L2', 'L1']);
  });

  it('never mutates the input array', () => {
    const rooms = [mk({ gameType: 'king', updatedAt: 1, code: 'A' }), mk({ gameType: 'king', updatedAt: 9, code: 'B' })];
    const before = rooms.map((r) => r.code);
    sortRooms(rooms, 'recent');
    expect(rooms.map((r) => r.code)).toEqual(before);
  });
});

describe('countRoomsByGame', () => {
  it('counts per game plus the total under all', () => {
    const rooms = [mk({ gameType: 'king' }), mk({ gameType: 'king' }), mk({ gameType: 'tarneeb' })];
    const c = countRoomsByGame(rooms);
    expect(c.all).toBe(3);
    expect(c.king).toBe(2);
    expect(c.tarneeb).toBe(1);
    expect(c.durak).toBe(0);
    expect(c.deberc).toBe(0);
  });

  it('is all-zero for an empty list', () => {
    const c = countRoomsByGame([]);
    expect(c.all).toBe(0);
    expect(c.king).toBe(0);
  });
});
