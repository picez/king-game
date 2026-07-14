// ---------------------------------------------------------------------------
// Visual asset manifest (Stage 12.1). The single source of truth for the
// generated "Levantine Card Lounge" bitmap assets under public/ — used by the
// guard test now and by the UI/CSS integration from Stage 12.2 onward.
//
// v1 assets are PROCEDURAL PNGs (scripts/gen-visual-assets.mjs, dep-free — same
// technique as the PWA icons). They can be swapped for image-model / webp art at
// the SAME `src` later; update `format`/`maxBytes` here if the format changes.
// Pure data — no Node/React import, safe on client + server + tests.
// ---------------------------------------------------------------------------

export type VisualFormat = 'png' | 'webp';
export type VisualPriority = 'P0' | 'P1' | 'P2';

export interface VisualAsset {
  id: string;
  /** Public URL path (served from public/); always starts with '/'. */
  src: string;
  format: VisualFormat;
  /** Guard-test upper bound in bytes (set from the real generated size + headroom). */
  maxBytes: number;
  priority: VisualPriority;
  /** True once the file is committed under public/ (all P0 are present today). */
  present: boolean;
  /**
   * Optional smaller WebP variant (Stage 12.9) served in preference to `src` via
   * CSS `image-set()`; the PNG `src` stays as the universal fallback. Only the big
   * OPAQUE assets are converted (heroes/felt/back) — small alpha icons stay PNG.
   */
  webp?: string;
}

export const VISUAL_ASSETS: readonly VisualAsset[] = [
  { id: 'felt-tile',      src: '/visual/felt-tile.png',            format: 'png', maxBytes: 340_000, priority: 'P0', present: true, webp: '/visual/felt-tile.webp' },
  { id: 'menu-hero-portrait', src: '/visual/menu-hero-portrait.png', format: 'png', maxBytes: 720_000, priority: 'P0', present: true, webp: '/visual/menu-hero-portrait.webp' },
  { id: 'menu-hero-wide', src: '/visual/menu-hero-wide.png',        format: 'png', maxBytes: 720_000, priority: 'P0', present: true, webp: '/visual/menu-hero-wide.webp' },
  { id: 'card-back-green', src: '/cards/back/back-green.png',       format: 'png', maxBytes: 260_000, priority: 'P0', present: true, webp: '/cards/back/back-green.webp' },
  // Stage 13.0: burgundy/gold alternate card back (a profile visual pref). P1 so
  // the "8 P0 assets" invariant is unchanged; carries a WebP variant like green.
  { id: 'card-back-red',  src: '/cards/back/back-red.png',          format: 'png', maxBytes: 260_000, priority: 'P1', present: true, webp: '/cards/back/back-red.webp' },
  // Stage 13.5: sapphire-blue + charcoal/gold alternate card backs (profile prefs).
  { id: 'card-back-blue', src: '/cards/back/back-blue.png',         format: 'png', maxBytes: 260_000, priority: 'P1', present: true, webp: '/cards/back/back-blue.webp' },
  { id: 'card-back-dark', src: '/cards/back/back-dark.png',         format: 'png', maxBytes: 260_000, priority: 'P1', present: true, webp: '/cards/back/back-dark.webp' },
  { id: 'icon-king',      src: '/visual/icons/game-king.png',       format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  { id: 'icon-durak',     src: '/visual/icons/game-durak.png',      format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  { id: 'icon-deberc',    src: '/visual/icons/game-deberc.png',     format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  { id: 'icon-tarneeb',   src: '/visual/icons/game-tarneeb.png',    format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  // Stage 19.9: Preferans emblem (top hat) — the 5th available game gains its own icon.
  { id: 'icon-preferans', src: '/visual/icons/game-preferans.png',  format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  // Stage 30.7: 51 (Syrian 51) emblem (two fanned cards) — the 6th available game.
  { id: 'icon-fifty-one', src: '/visual/icons/game-fifty-one.png',  format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  // P1 (Stage 12.8): ornamental finish frame + unified seat-status badge coins.
  { id: 'finish-frame',   src: '/visual/finish-frame.png',          format: 'png', maxBytes: 260_000, priority: 'P1', present: true },
  { id: 'badge-host',     src: '/visual/badges/badge-host.png',     format: 'png', maxBytes: 60_000,  priority: 'P1', present: true },
  { id: 'badge-bot',      src: '/visual/badges/badge-bot.png',      format: 'png', maxBytes: 60_000,  priority: 'P1', present: true },
  { id: 'badge-offline',  src: '/visual/badges/badge-offline.png',  format: 'png', maxBytes: 60_000,  priority: 'P1', present: true },
  { id: 'badge-active',   src: '/visual/badges/badge-active.png',   format: 'png', maxBytes: 60_000,  priority: 'P1', present: true },
] as const;

/** Documented ceiling for the TOTAL present art footprint (P0 ≈ 1.9 MB + P1 headroom). */
export const VISUAL_TOTAL_MAX_BYTES = 2_900_000;

/** Kinds of unified seat-status badge (Stage 12.8). */
export type SeatBadge = 'host' | 'bot' | 'offline' | 'active';
/** Single source for a seat-status badge coin URL (mirrors the `badge-*` manifest ids). */
export function seatBadgeSrc(kind: SeatBadge): string {
  return `/visual/badges/badge-${kind}.png`;
}

/** The manifest entry for an id, or null. */
export function visualAsset(id: string): VisualAsset | null {
  return VISUAL_ASSETS.find((a) => a.id === id) ?? null;
}

/**
 * Single source for a game's emblem PNG URL (Stage 12.3). Mirrors the manifest
 * `icon-<game>` entries — the six `available` games each have a transparent
 * 512×512 icon under public/visual/icons (Preferans added Stage 19.9, 51 added
 * Stage 30.7). Callers
 * render it in an `<img>` with an emoji `onError` fallback (see `GameIcon`), so a
 * missing file never breaks the UI.
 */
export function gameIconSrc(game: string): string {
  return `/visual/icons/game-${game}.png`;
}
