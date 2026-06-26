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
  it('registers King as the default game', () => {
    expect(DEFAULT_GAME_TYPE).toBe('king');
    expect(GAME_TYPES).toEqual(['king']);
    expect(GAME_CATALOG.king).toMatchObject({
      id: 'king',
      minPlayers: 3,
      maxPlayers: 4,
      supportsLocal: true,
      supportsOnline: true,
      supportsBots: true,
      rulesDoc: 'KING_RULES.md',
    });
  });

  it('validates game types at runtime', () => {
    expect(isGameType('king')).toBe(true);
    expect(isGameType('poker')).toBe(false);
    expect(getGameCatalogEntry('king')?.id).toBe('king');
    expect(getGameCatalogEntry('poker')).toBeNull();
  });

  it('exposes a public catalog with King and NO private fields', () => {
    const pub = publicGameCatalog();
    expect(pub.map((g) => g.id)).toEqual(['king']);
    const king = pub[0];
    expect(king).toEqual({
      id: 'king',
      title: 'gameType.king',
      shortTitle: 'gameType.king',
      minPlayers: 3,
      maxPlayers: 4,
      defaultPlayerCount: 4,
      supportsLocal: true,
      supportsOnline: true,
      supportsBots: true,
    });
    // Internal-only fields must never leak into the public shape.
    expect('rulesDoc' in king).toBe(false);
    expect('titleKey' in king).toBe(false);
  });
});

