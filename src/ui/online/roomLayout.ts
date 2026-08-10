import type { GameType } from '../../games/catalog';

/**
 * (Stage 38.0.16.3) WHAT A SCENE NEEDS — declared by the game, never inferred from the
 * viewport.
 *
 * 38.0.16 reserved a 22.5rem rail at ≥1620px purely because the screen was wide. That made
 * the three chat states equal by shrinking all of them: the Fifty-One board ran 1528px inside
 * a 1920px page with the chat SHUT. 38.0.16.1 deleted the rail and left one absolute rule —
 * the stage spans the whole room layout, always — with a note that a future rail must be
 * EARNED by a screen declaring it wants less than the full width.
 *
 * This is that declaration. A capability says one thing only: how wide this game's scene
 * actually is at its worst case. It is not a chat setting, it does not name a panel, and it
 * carries no styling — `RoomSocial` never reads it and there is still exactly one chat
 * component for all seven games. Everything else (the threshold, the grid, the mirroring) is
 * derived from the numbers below by the shared room-layout contract in `social.css`.
 *
 * The footprints are MEASURED, not chosen — `node scripts/footprint-audit.mjs` computes the
 * union of every painting/interactive element inside `.game-stage`, at 1366→2560, LTR and
 * RTL, at the worst supported player count with the longest test names:
 *
 *   King  900.00px at every width (widest contributor `.screen`, a max-width box)
 *   Poker 700.81px at every width (widest contributor `.poker-slider`)  → declared 704
 *
 * The other five genuinely use the width they are given — top bar, seats, hand, melds — so
 * they declare `none` and keep the fallback: the chat follows the unchanged scene in normal
 * flow and the document simply gets taller.
 */
export type SidecarCapability = 'none' | 'sidecar-compact' | 'sidecar-wide';

/** The scene width each capability promises to stay inside, in CSS px. */
export const SIDECAR_FOOTPRINT_PX: Record<Exclude<SidecarCapability, 'none'>, number> = {
  'sidecar-compact': 704,
  'sidecar-wide': 900,
};

/** The side column the chat needs, and the room it needs around it. */
export const SIDECAR_CHAT_PX = 336;
/** Between the scene and the panel — small enough that the panel reads as part of the table. */
export const SIDECAR_GAP_PX = 16;
/** Between the panel and the window edge, so it never looks stuck to the glass. */
export const SIDECAR_MARGIN_PX = 24;
/**
 * `scrollbar-gutter: stable` costs the LAYOUT width that a media query never sees: measured
 * at 1660 and 1680, `innerWidth` 1660 with `clientWidth` 1645. A threshold that ignored it
 * would switch the sidecar on 15px before the room for it exists.
 */
export const SCROLLBAR_GUTTER_PX = 15;

/**
 * The side band must be symmetrical, or turning the chat on would move the game off centre —
 * which is the shift this whole contract exists to prevent. So the scene needs its own width
 * plus the panel's column TWICE, and the threshold adds the gutter the media query cannot see.
 */
export function minimumClientWidth(capability: Exclude<SidecarCapability, 'none'>): number {
  return SIDECAR_FOOTPRINT_PX[capability] + 2 * (SIDECAR_CHAT_PX + SIDECAR_GAP_PX + SIDECAR_MARGIN_PX);
}
export function minimumViewportWidth(capability: Exclude<SidecarCapability, 'none'>): number {
  return minimumClientWidth(capability) + SCROLLBAR_GUTTER_PX;
}

/**
 * The thresholds the CSS media queries use. Kept here beside the arithmetic that produces
 * them so the two can never drift apart silently — `roomLayout.test.ts` fails if they do.
 *   compact: 704 + 2 × 376 = 1456, + 15 gutter = 1471 → 1472
 *   wide:    900 + 2 × 376 = 1652, + 15 gutter = 1667 → 1668
 */
export const SIDECAR_THRESHOLD_PX: Record<Exclude<SidecarCapability, 'none'>, number> = {
  'sidecar-compact': 1472,
  'sidecar-wide': 1668,
};

const CAPABILITY: Record<GameType, SidecarCapability> = {
  king: 'sidecar-wide',
  poker: 'sidecar-compact',
  durak: 'none',
  deberc: 'none',
  tarneeb: 'none',
  preferans: 'none',
  'fifty-one': 'none',
};

export function sidecarCapability(gameType: GameType | undefined | null): SidecarCapability {
  return (gameType && CAPABILITY[gameType]) || 'none';
}

/**
 * The class list for `.room-layout`. The capability class only MARKS the game; the shared
 * contract in `social.css` decides at which width it turns into a side column, so there is no
 * JS resize listener and nothing to keep in sync at runtime.
 */
export function roomLayoutClass(gameType: GameType | undefined | null): string {
  const capability = sidecarCapability(gameType);
  return capability === 'none' ? 'room-layout' : `room-layout room-layout--${capability}`;
}
