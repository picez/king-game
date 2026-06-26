// ---------------------------------------------------------------------------
// Game catalog client (Stage 8.3).
//
// `GET /api/games` returns the STATIC public catalog (no DB needed). The same
// catalog is also bundled in the client (src/games/catalog.ts), so this fetch is
// best-effort: any failure (offline, no server, bad shape) falls back to the
// bundled `publicGameCatalog()`. The menu therefore always has a catalog to show
// and existing Local/Host/Join flows never depend on the network here.
// ---------------------------------------------------------------------------

import { publicGameCatalog, isGameType, type PublicGameEntry, type GameType } from '../games/catalog';

/** Validate one server entry into a PublicGameEntry, or null if malformed. */
function normalizeEntry(g: unknown): PublicGameEntry | null {
  if (!g || typeof g !== 'object') return null;
  const o = g as Record<string, unknown>;
  if (!isGameType(o.id)) return null; // unknown game the client can't render → drop
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);
  const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const bool = (k: string) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : null);

  const title = str('title');
  const shortTitle = str('shortTitle');
  const minPlayers = num('minPlayers');
  const maxPlayers = num('maxPlayers');
  const dpc = o.defaultPlayerCount;
  const supportsLocal = bool('supportsLocal');
  const supportsOnline = bool('supportsOnline');
  const supportsBots = bool('supportsBots');

  if (title == null || shortTitle == null || minPlayers == null || maxPlayers == null) return null;
  if (dpc !== 3 && dpc !== 4) return null;
  if (supportsLocal == null || supportsOnline == null || supportsBots == null) return null;

  return {
    id: o.id as GameType, title, shortTitle, minPlayers, maxPlayers,
    defaultPlayerCount: dpc, supportsLocal, supportsOnline, supportsBots,
  };
}

/**
 * Pure parser for a `GET /api/games` body. Returns the validated entries, or
 * null when the payload is missing/not the expected shape (→ caller falls back
 * to the bundled catalog). Unknown game ids are dropped, not failed.
 */
export function normalizeGameCatalog(data: unknown): PublicGameEntry[] | null {
  if (!data || typeof data !== 'object') return null;
  const games = (data as { games?: unknown }).games;
  if (!Array.isArray(games)) return null;
  const out: PublicGameEntry[] = [];
  for (const g of games) {
    const e = normalizeEntry(g);
    if (e) out.push(e);
  }
  return out.length ? out : null;
}

export interface FetchCatalogOptions {
  /** HTTP origin of the API (e.g. apiBaseFromWsUrl(wsUrl)); '' = same-origin. */
  baseUrl?: string;
  signal?: AbortSignal;
  /** Inject a fetch for tests; defaults to global fetch (null when absent). */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the public game catalog, ALWAYS resolving to a usable list: on any
 * network/parse failure it returns the bundled static catalog. Never throws.
 */
export async function fetchGameCatalog(opts: FetchCatalogOptions = {}): Promise<PublicGameEntry[]> {
  const doFetch = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!doFetch) return publicGameCatalog();
  try {
    const res = await doFetch(`${opts.baseUrl ?? ''}/api/games`, {
      signal: opts.signal, headers: { accept: 'application/json' },
    });
    if (!res.ok) return publicGameCatalog();
    const data = await res.json();
    return normalizeGameCatalog(data) ?? publicGameCatalog();
  } catch {
    return publicGameCatalog(); // graceful fallback to the bundled catalog
  }
}
