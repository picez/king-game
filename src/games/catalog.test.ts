import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_TYPE,
  GAME_CATALOG,
  GAME_TYPES,
  getGameCatalogEntry,
  isGameType,
  publicGameCatalog,
} from './catalog';

describe('game catalog', () => {
  it('registers King, Durak and Deberc (all available) plus Tarneeb (coming soon)', () => {
    expect(DEFAULT_GAME_TYPE).toBe('king');
    expect(GAME_TYPES).toEqual(['king', 'durak', 'deberc', 'tarneeb']);
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
      supportsLocal: false, supportsOnline: false, supportsBots: true,
      status: 'coming_soon', rulesDoc: 'TARNEEB_RULES.md',
    });
  });

  it('validates game types at runtime', () => {
    expect(isGameType('king')).toBe(true);
    expect(isGameType('durak')).toBe(true);
    expect(isGameType('deberc')).toBe(true);
    expect(isGameType('tarneeb')).toBe(true);
    expect(isGameType('poker')).toBe(false);
    expect(getGameCatalogEntry('durak')?.id).toBe('durak');
    expect(getGameCatalogEntry('deberc')?.id).toBe('deberc');
    expect(getGameCatalogEntry('tarneeb')?.id).toBe('tarneeb');
    expect(getGameCatalogEntry('poker')).toBeNull();
  });

  it('exposes all games publicly with status and NO private fields', () => {
    const pub = publicGameCatalog();
    expect(pub.map((g) => g.id)).toEqual(['king', 'durak', 'deberc', 'tarneeb']);
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
      supportsLocal: false, supportsOnline: false, supportsBots: true, status: 'coming_soon',
    });
    // Internal-only fields must never leak into the public shape.
    for (const g of pub) {
      expect('rulesDoc' in g).toBe(false);
      expect('titleKey' in g).toBe(false);
    }
  });
});
