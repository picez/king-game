import { describe, it, expect } from 'vitest';
import { normalizeGameCatalog, fetchGameCatalog } from './gamesApi';
import { publicGameCatalog } from '../games/catalog';

const KING = {
  id: 'king', title: 'gameType.king', shortTitle: 'gameType.king',
  minPlayers: 3, maxPlayers: 4, defaultPlayerCount: 4,
  supportsLocal: true, supportsOnline: true, supportsBots: true, status: 'available',
};
const DURAK = {
  id: 'durak', title: 'gameType.durak', shortTitle: 'gameType.durak',
  minPlayers: 2, maxPlayers: 4, defaultPlayerCount: 2,
  supportsLocal: false, supportsOnline: false, supportsBots: true, status: 'coming_soon',
};
const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body } as unknown as Response);

describe('normalizeGameCatalog', () => {
  it('parses a valid catalog payload (King + Durak)', () => {
    const games = normalizeGameCatalog({ games: [KING, DURAK] });
    expect(games).toEqual([KING, DURAK]);
  });
  it('accepts a 2-player default (Durak) and defaults an unknown status to coming_soon', () => {
    const { status, ...noStatus } = DURAK; void status;
    const games = normalizeGameCatalog({ games: [noStatus] });
    expect(games).toEqual([{ ...DURAK, status: 'coming_soon' }]);
  });
  it('returns null for a non-object / missing games', () => {
    expect(normalizeGameCatalog(null)).toBeNull();
    expect(normalizeGameCatalog('nope')).toBeNull();
    expect(normalizeGameCatalog({})).toBeNull();
    expect(normalizeGameCatalog({ games: 'x' })).toBeNull();
  });
  it('drops unknown game ids and malformed entries', () => {
    expect(normalizeGameCatalog({ games: [{ ...KING, id: 'poker' }] })).toBeNull(); // unknown id → dropped → empty → null
    expect(normalizeGameCatalog({ games: [{ ...KING, defaultPlayerCount: 5 }] })).toBeNull();
    expect(normalizeGameCatalog({ games: [{ ...KING, supportsBots: 'yes' }] })).toBeNull();
    expect(normalizeGameCatalog({ games: [{ ...KING, title: 123 }] })).toBeNull();
  });
  it('keeps only the valid entries when mixed', () => {
    const games = normalizeGameCatalog({ games: [KING, { id: 'poker' }] });
    expect(games).toEqual([KING]);
  });
});

describe('fetchGameCatalog', () => {
  it('returns the parsed catalog when the API responds well', async () => {
    const games = await fetchGameCatalog({ fetchImpl: (async () => okResponse({ games: [KING] })) as unknown as typeof fetch });
    expect(games).toEqual([KING]);
  });
  it('falls back to the bundled catalog on a network error', async () => {
    const games = await fetchGameCatalog({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(games).toEqual(publicGameCatalog());
  });
  it('falls back on a non-ok response', async () => {
    const games = await fetchGameCatalog({ fetchImpl: (async () => ({ ok: false, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch });
    expect(games).toEqual(publicGameCatalog());
  });
  it('falls back on a malformed body', async () => {
    const games = await fetchGameCatalog({ fetchImpl: (async () => okResponse({ nope: 1 })) as unknown as typeof fetch });
    expect(games).toEqual(publicGameCatalog());
  });
  it('builds the request URL from baseUrl', async () => {
    let seenUrl = '';
    await fetchGameCatalog({
      baseUrl: 'https://king.example.com',
      fetchImpl: (async (u: string) => { seenUrl = u; return okResponse({ games: [KING] }); }) as unknown as typeof fetch,
    });
    expect(seenUrl).toBe('https://king.example.com/api/games');
  });
});
