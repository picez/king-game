/**
 * Public game catalog.
 *
 * This is intentionally small for now: King remains the only implemented game,
 * but every new card game should enter through this registry instead of adding
 * scattered string literals across room discovery, stats, and settings.
 */

export const GAME_TYPES = ['king'] as const;

export type GameType = typeof GAME_TYPES[number];

export interface GameCatalogEntry {
  id: GameType;
  /** Translation key for the full display name. */
  titleKey: string;
  /** Translation key for compact labels, e.g. the room browser. */
  shortTitleKey: string;
  minPlayers: number;
  maxPlayers: number;
  defaultPlayerCount: 3 | 4;
  supportsLocal: boolean;
  supportsOnline: boolean;
  supportsBots: boolean;
  rulesDoc: string;
}

export const DEFAULT_GAME_TYPE: GameType = 'king';

export const GAME_CATALOG = {
  king: {
    id: 'king',
    titleKey: 'gameType.king',
    shortTitleKey: 'gameType.king',
    minPlayers: 3,
    maxPlayers: 4,
    defaultPlayerCount: 4,
    supportsLocal: true,
    supportsOnline: true,
    supportsBots: true,
    rulesDoc: 'KING_RULES.md',
  },
} satisfies Record<GameType, GameCatalogEntry>;

export function isGameType(value: unknown): value is GameType {
  return typeof value === 'string' && (GAME_TYPES as readonly string[]).includes(value);
}

export function getGameCatalogEntry(value: unknown): GameCatalogEntry | null {
  return isGameType(value) ? GAME_CATALOG[value] : null;
}

/**
 * Public, privacy-safe shape of one catalog entry — exactly what `GET /api/games`
 * returns and what the menu's game selector consumes. `title`/`shortTitle` are
 * i18n KEYS (the server is language-agnostic; the client resolves them with
 * `t()`). Intentionally omits any internal field (e.g. `rulesDoc`).
 */
export interface PublicGameEntry {
  id: GameType;
  title: string;
  shortTitle: string;
  minPlayers: number;
  maxPlayers: number;
  defaultPlayerCount: 3 | 4;
  supportsLocal: boolean;
  supportsOnline: boolean;
  supportsBots: boolean;
}

/** The static catalog mapped to the public API shape (no private fields). */
export function publicGameCatalog(): PublicGameEntry[] {
  return GAME_TYPES.map((id) => {
    const e = GAME_CATALOG[id];
    return {
      id: e.id,
      title: e.titleKey,
      shortTitle: e.shortTitleKey,
      minPlayers: e.minPlayers,
      maxPlayers: e.maxPlayers,
      defaultPlayerCount: e.defaultPlayerCount,
      supportsLocal: e.supportsLocal,
      supportsOnline: e.supportsOnline,
      supportsBots: e.supportsBots,
    };
  });
}

