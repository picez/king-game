import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_TYPE,
  GAME_CATALOG,
  GAME_TYPES,
  getGameCatalogEntry,
  isGameType,
  normalizeFavoriteGame,
  publicGameCatalog,
} from './catalog';

describe('game catalog', () => {
  it('registers King, Durak, Deberc, Tarneeb + Preferans (all available)', () => {
    expect(DEFAULT_GAME_TYPE).toBe('king'); // unchanged
    expect(GAME_TYPES).toEqual(['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one', 'poker']);
    expect(GAME_CATALOG.king).toMatchObject({
      id: 'king', minPlayers: 3, maxPlayers: 4, supportsLocal: true,
      supportsOnline: true, supportsBots: true, status: 'available', rulesDoc: 'KING_RULES.md',
    });
    expect(GAME_CATALOG.durak).toMatchObject({
      id: 'durak', minPlayers: 2, maxPlayers: 5, defaultPlayerCount: 2,
      supportsLocal: true, supportsOnline: true, supportsBots: true,
      status: 'available', rulesDoc: 'DURAK_RULES.md',
    });
    expect(GAME_CATALOG.deberc).toMatchObject({
      id: 'deberc', minPlayers: 3, maxPlayers: 4, defaultPlayerCount: 3,
      supportsLocal: true, supportsOnline: true, supportsBots: true,
      status: 'available', rulesDoc: 'DEBERC_RULES.md',
    });
    expect(GAME_CATALOG.tarneeb).toMatchObject({
      id: 'tarneeb', minPlayers: 4, maxPlayers: 4, defaultPlayerCount: 4,
      supportsLocal: true, supportsOnline: true, supportsBots: true,
      status: 'available', rulesDoc: 'TARNEEB_RULES.md',
    });
    // Preferans (Stage 19.7): released — local + online + stats.
    expect(GAME_CATALOG.preferans).toMatchObject({
      id: 'preferans', minPlayers: 3, maxPlayers: 3, defaultPlayerCount: 3,
      supportsLocal: true, supportsOnline: true, supportsBots: true,
      status: 'available', rulesDoc: 'PREFERANS_RULES.md',
    });
  });

  it('registers 51 (Syrian 51) as available — fully released (Stage 30.7)', () => {
    expect(GAME_CATALOG['fifty-one']).toMatchObject({
      id: 'fifty-one', minPlayers: 2, maxPlayers: 4, defaultPlayerCount: 4,
      supportsLocal: true,    // Stage 30.3: local play
      supportsOnline: true,   // Stage 30.5: online rooms
      supportsBots: true,     // pure-core bot exists (30.1)
      status: 'available',    // Stage 30.7: fully released (stats + favorite + achievement)
      rulesDoc: '51_RULES.md',
    });
    expect(isGameType('fifty-one')).toBe(true);
    expect(getGameCatalogEntry('fifty-one')?.status).toBe('available');
  });

  it('registers Poker (No-Limit Texas Hold\'em) as available — 7th game (Stage 37.4)', () => {
    expect(GAME_CATALOG.poker).toMatchObject({
      id: 'poker', minPlayers: 2, maxPlayers: 6, defaultPlayerCount: 4,
      supportsLocal: true, supportsOnline: true, supportsBots: true,
      status: 'available', rulesDoc: 'POKER_RULES.md',
    });
    expect(isGameType('poker')).toBe(true);
    expect(getGameCatalogEntry('poker')?.status).toBe('available');
  });

  it('validates game types at runtime', () => {
    expect(isGameType('king')).toBe(true);
    expect(isGameType('durak')).toBe(true);
    expect(isGameType('deberc')).toBe(true);
    expect(isGameType('tarneeb')).toBe(true);
    expect(isGameType('chess')).toBe(false);
    expect(getGameCatalogEntry('durak')?.id).toBe('durak');
    expect(getGameCatalogEntry('deberc')?.id).toBe('deberc');
    expect(getGameCatalogEntry('tarneeb')?.id).toBe('tarneeb');
    expect(isGameType('preferans')).toBe(true);
    expect(getGameCatalogEntry('preferans')?.status).toBe('available');
    expect(getGameCatalogEntry('chess')).toBeNull();
  });

  it('normalizes the favorite game, falling back to King (Stage 13.3)', () => {
    for (const g of GAME_TYPES) expect(normalizeFavoriteGame(g)).toBe(g);
    expect(normalizeFavoriteGame('chess')).toBe(DEFAULT_GAME_TYPE);
    expect(normalizeFavoriteGame(null)).toBe('king');
    expect(normalizeFavoriteGame(undefined)).toBe('king');
    expect(normalizeFavoriteGame(42)).toBe('king');
  });

  it('exposes all games publicly with status and NO private fields', () => {
    const pub = publicGameCatalog();
    expect(pub.map((g) => g.id)).toEqual(['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one', 'poker']);
    // 51 surfaces publicly as available — local + online on (no private fields).
    const fiftyOne = pub.find((g) => g.id === 'fifty-one')!;
    expect(fiftyOne).toEqual({
      id: 'fifty-one', title: 'gameType.fifty-one', shortTitle: 'gameType.fifty-one',
      minPlayers: 2, maxPlayers: 4, defaultPlayerCount: 4,
      supportsLocal: true, supportsOnline: true, supportsBots: true, status: 'available',
    });
    // Preferans surfaces publicly as available — startable local AND online.
    const preferans = pub.find((g) => g.id === 'preferans')!;
    expect(preferans).toEqual({
      id: 'preferans', title: 'gameType.preferans', shortTitle: 'gameType.preferans',
      minPlayers: 3, maxPlayers: 3, defaultPlayerCount: 3,
      supportsLocal: true, supportsOnline: true, supportsBots: true, status: 'available',
    });
    const king = pub.find((g) => g.id === 'king')!;
    expect(king).toEqual({
      id: 'king', title: 'gameType.king', shortTitle: 'gameType.king',
      minPlayers: 3, maxPlayers: 4, defaultPlayerCount: 4,
      supportsLocal: true, supportsOnline: true, supportsBots: true, status: 'available',
    });
    const durak = pub.find((g) => g.id === 'durak')!;
    expect(durak.status).toBe('available'); // released (Stage 9.13)
    expect(durak.supportsLocal).toBe(true);
    expect(durak.supportsOnline).toBe(true);
    const deberc = pub.find((g) => g.id === 'deberc')!;
    expect(deberc.status).toBe('available'); // integrated Stage 4
    expect(deberc.supportsLocal).toBe(true);
    expect(deberc.supportsOnline).toBe(true);
    const tarneeb = pub.find((g) => g.id === 'tarneeb')!;
    expect(tarneeb).toEqual({
      id: 'tarneeb', title: 'gameType.tarneeb', shortTitle: 'gameType.tarneeb',
      minPlayers: 4, maxPlayers: 4, defaultPlayerCount: 4,
      supportsLocal: true, supportsOnline: true, supportsBots: true, status: 'available',
    });
    // Internal-only fields must never leak into the public shape.
    for (const g of pub) {
      expect('rulesDoc' in g).toBe(false);
      expect('titleKey' in g).toBe(false);
    }
  });
});
