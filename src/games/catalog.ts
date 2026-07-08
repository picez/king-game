/**
 * Public game catalog.
 *
 * Every card game enters through this registry instead of scattering string
 * literals across room discovery, stats, and settings. King is the default;
 * King, Durak, and Deberc are all fully playable (`available`). Tarneeb is
 * registered but `coming_soon` (Stage 10.2 — pure core only, not startable yet).
 */

export const GAME_TYPES = ['king', 'durak', 'deberc', 'tarneeb'] as const;

export type GameType = typeof GAME_TYPES[number];

/**
 * Playability status surfaced to the client:
 *  - 'available'   → fully playable (King, Durak, and Deberc today);
 *  - 'coming_soon' → registered but not yet startable (Tarneeb today);
 *  - 'experimental'→ playable but rough (reserved; unused for now).
 */
export type GameAvailability = 'available' | 'coming_soon' | 'experimental';

export interface GameCatalogEntry {
  id: GameType;
  /** Translation key for the full display name. */
  titleKey: string;
  /** Translation key for compact labels, e.g. the room browser. */
  shortTitleKey: string;
  minPlayers: number;
  maxPlayers: number;
  defaultPlayerCount: 2 | 3 | 4 | 5;
  supportsLocal: boolean;
  supportsOnline: boolean;
  supportsBots: boolean;
  /** Whether the game can actually be started yet (gates the menu). */
  status: GameAvailability;
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
    status: 'available',
    rulesDoc: 'KING_RULES.md',
  },
  durak: {
    id: 'durak',
    titleKey: 'gameType.durak',
    shortTitleKey: 'gameType.durak',
    minPlayers: 2,
    maxPlayers: 5,          // FIX-3: 36-card deck deals 6 each up to 5 players
    defaultPlayerCount: 2,
    supportsLocal: true,    // local play (Stage 9.3)
    supportsOnline: true,   // server-authoritative online rooms (Stage 9.6)
    supportsBots: true,     // the pure core has a working bot
    status: 'available',    // released (Stage 9.13 audit); stats recorded (DURAK-1)
    rulesDoc: 'DURAK_RULES.md',
  },
  deberc: {
    id: 'deberc',
    titleKey: 'gameType.deberc',
    shortTitleKey: 'gameType.deberc',
    minPlayers: 3,          // 3 = each for self; 4 = two teams of 2 (DEBERC_RULES §3)
    maxPlayers: 4,
    defaultPlayerCount: 3,
    supportsLocal: true,    // local play (Stage 4)
    supportsOnline: true,   // server-authoritative online rooms (Stage 4)
    supportsBots: true,     // pure core has a working bot (Stage 3 soak)
    status: 'available',    // integrated Stage 4; match size (small/big) picked per game
    rulesDoc: 'DEBERC_RULES.md',
  },
  tarneeb: {
    id: 'tarneeb',
    titleKey: 'gameType.tarneeb',
    shortTitleKey: 'gameType.tarneeb',
    minPlayers: 4,          // fixed 2×2 partnerships, seats 0/2 vs 1/3 (TARNEEB_RULES §2)
    maxPlayers: 4,
    defaultPlayerCount: 4,
    supportsLocal: true,    // Stage 10.3: local hot-seat UI (1 human + 3 bots)
    supportsOnline: false,  // no server wiring yet (server never starts Tarneeb rooms)
    supportsBots: true,     // pure core has a working bot (Stage 10.1 soak)
    status: 'coming_soon',  // still coming_soon for ONLINE; local play is enabled via supportsLocal
    rulesDoc: 'TARNEEB_RULES.md',
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
  defaultPlayerCount: 2 | 3 | 4 | 5;
  supportsLocal: boolean;
  supportsOnline: boolean;
  supportsBots: boolean;
  status: GameAvailability;
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
      status: e.status,
    };
  });
}
