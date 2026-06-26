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
  it('registers King (available) and Durak (coming_soon)', () => {
    expect(DEFAULT_GAME_TYPE).toBe('king');
    expect(GAME_TYPES).toEqual(['king', 'durak']);
    expect(GAME_CATALOG.king).toMatchObject({
      id: 'king', minPlayers: 3, maxPlayers: 4, supportsLocal: true,
      supportsOnline: true, supportsBots: true, status: 'available', rulesDoc: 'KING_RULES.md',
    });
    expect(GAME_CATALOG.durak).toMatchObject({
      id: 'durak', minPlayers: 2, maxPlayers: 4, defaultPlayerCount: 2,
      supportsLocal: false, supportsOnline: false, supportsBots: true,
      status: 'coming_soon', rulesDoc: 'DURAK_RULES.md',
    });
  });

  it('validates game types at runtime', () => {
    expect(isGameType('king')).toBe(true);
    expect(isGameType('durak')).toBe(true);
    expect(isGameType('poker')).toBe(false);
    expect(getGameCatalogEntry('durak')?.id).toBe('durak');
    expect(getGameCatalogEntry('poker')).toBeNull();
  });

  it('exposes both games publicly with status and NO private fields', () => {
    const pub = publicGameCatalog();
    expect(pub.map((g) => g.id)).toEqual(['king', 'durak']);
    const king = pub.find((g) => g.id === 'king')!;
    expect(king).toEqual({
      id: 'king', title: 'gameType.king', shortTitle: 'gameType.king',
      minPlayers: 3, maxPlayers: 4, defaultPlayerCount: 4,
      supportsLocal: true, supportsOnline: true, supportsBots: true, status: 'available',
    });
    const durak = pub.find((g) => g.id === 'durak')!;
    expect(durak.status).toBe('coming_soon');
    expect(durak.supportsLocal).toBe(false);
    expect(durak.supportsOnline).toBe(false);
    // Internal-only fields must never leak into the public shape.
    for (const g of pub) {
      expect('rulesDoc' in g).toBe(false);
      expect('titleKey' in g).toBe(false);
    }
  });
});
