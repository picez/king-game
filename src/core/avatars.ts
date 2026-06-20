/**
 * Avatar set (pure data + helpers, no React). Avatars are a fixed whitelist of
 * emoji ids — never free text — so they can never carry HTML/script (no XSS).
 * A stable default is derived from a seed (the player name) when none is chosen.
 */

export const AVATARS: string[] = [
  '🦊', '🐼', '🐯', '🦁', '🐵', '🐸', '🐧', '🦉', '🐙', '🦄',
  '🐲', '🐺', '🐱', '🐶', '🐰', '🐻', '🦅', '🐬', '🦖', '🐝',
];

/** Avatar shown for server-side bots. */
export const BOT_AVATAR = '🤖';

export function isValidAvatar(id: unknown): id is string {
  return typeof id === 'string' && AVATARS.includes(id);
}

/** Deterministic default avatar from a seed (e.g. the player name/id). */
export function defaultAvatar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

/** Returns the id if whitelisted, otherwise a stable default for the seed. */
export function sanitizeAvatar(id: unknown, seed: string): string {
  return isValidAvatar(id) ? id : defaultAvatar(seed);
}

/** Stable per-seat marker id (semantic only — UI shows avatar + colour, not this). */
export const SEAT_MARKERS = ['①', '②', '③', '④'];
export function seatMarker(index: number): string {
  return SEAT_MARKERS[index] ?? `#${index + 1}`;
}

/**
 * Stable per-seat player colour for score-tracker chips/legend. Bright, high
 * contrast on the dark-green table; distinct hues (blue / gold / pink / teal).
 */
export const SEAT_COLORS = ['#5db4ff', '#ffd24a', '#ff8fb0', '#62e0b8'];
export function seatColor(index: number): string {
  return SEAT_COLORS[index] ?? '#cfd8dc';
}
