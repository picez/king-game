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
}

export const VISUAL_ASSETS: readonly VisualAsset[] = [
  { id: 'felt-tile',      src: '/visual/felt-tile.png',            format: 'png', maxBytes: 340_000, priority: 'P0', present: true },
  { id: 'menu-hero-portrait', src: '/visual/menu-hero-portrait.png', format: 'png', maxBytes: 720_000, priority: 'P0', present: true },
  { id: 'menu-hero-wide', src: '/visual/menu-hero-wide.png',        format: 'png', maxBytes: 720_000, priority: 'P0', present: true },
  { id: 'card-back-green', src: '/cards/back/back-green.png',       format: 'png', maxBytes: 260_000, priority: 'P0', present: true },
  { id: 'icon-king',      src: '/visual/icons/game-king.png',       format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  { id: 'icon-durak',     src: '/visual/icons/game-durak.png',      format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  { id: 'icon-deberc',    src: '/visual/icons/game-deberc.png',     format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
  { id: 'icon-tarneeb',   src: '/visual/icons/game-tarneeb.png',    format: 'png', maxBytes: 150_000, priority: 'P0', present: true },
] as const;

/** Sum of all P0 `maxBytes` — a documented ceiling for the total P0 art footprint. */
export const VISUAL_TOTAL_MAX_BYTES = 2_200_000;

/** The manifest entry for an id, or null. */
export function visualAsset(id: string): VisualAsset | null {
  return VISUAL_ASSETS.find((a) => a.id === id) ?? null;
}

/**
 * Single source for a game's emblem PNG URL (Stage 12.3). Mirrors the manifest
 * `icon-<game>` entries — the four `available` games each have a transparent
 * 512×512 icon under public/visual/icons. Callers render it in an `<img>` with an
 * emoji `onError` fallback (see `GameIcon`), so a missing file never breaks the UI.
 */
export function gameIconSrc(game: string): string {
  return `/visual/icons/game-${game}.png`;
}
