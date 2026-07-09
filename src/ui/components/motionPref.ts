// ---------------------------------------------------------------------------
// Animation-intensity preference — pure helpers (Stage 13.2).
//
// A LOCAL + profile-synced UI preference controlling how much of the CSS motion
// system (src/styles/motion.css & friends) actually plays. Purely visual: it is
// NEVER game state, never in the WS room protocol. No React / DOM / engine here,
// so it can be unit-tested and reused by both the client store and (via a mirror
// in src/net/userSettings.ts) the server validation without importing UI code.
//
// Values:
//   'system'  — follow the device: full motion unless the OS asks to reduce.
//   'full'    — the full motion system (still downgraded if the OS asks to reduce).
//   'reduced' — lighter motion: no infinite pulses / large flourishes, gentle fades.
//   'off'     — no decorative motion at all (elements stay visible & static).
//
// Accessibility invariant: the OS `prefers-reduced-motion: reduce` ALWAYS wins
// over a 'full'/'system' choice — we never force full motion onto a device that
// asked to reduce. See resolveEffectiveMotion() below.
// ---------------------------------------------------------------------------

export const ANIMATION_PREFERENCES = ['system', 'full', 'reduced', 'off'] as const;
export type AnimationPreference = (typeof ANIMATION_PREFERENCES)[number];

/** What actually applies after the OS override is folded in. */
export type EffectiveMotion = 'full' | 'reduced' | 'off';

export const DEFAULT_ANIMATION_PREFERENCE: AnimationPreference = 'system';

/** Any input → a valid AnimationPreference; unknown/legacy → 'system'. */
export function normalizeMotionPreference(v: string | null | undefined): AnimationPreference {
  return (ANIMATION_PREFERENCES as readonly string[]).includes(v as string)
    ? (v as AnimationPreference)
    : DEFAULT_ANIMATION_PREFERENCE;
}

/**
 * Resolves the effective motion after the accessibility override.
 *
 *   off     → 'off'      (always — an explicit "no motion" choice is honoured)
 *   reduced → 'reduced'  (explicit lighter-motion choice)
 *   full    → osReduce ? 'reduced' : 'full'   (OS reduce wins — never forced full)
 *   system  → osReduce ? 'reduced' : 'full'   (just follow the device)
 *
 * The OS is only ever allowed to DOWNGRADE motion (full → reduced), never to
 * silently disable it, and it can never upgrade 'off'/'reduced' back to full.
 */
export function resolveEffectiveMotion(pref: AnimationPreference, osReduce: boolean): EffectiveMotion {
  if (pref === 'off') return 'off';
  if (pref === 'reduced') return 'reduced';
  return osReduce ? 'reduced' : 'full';
}
