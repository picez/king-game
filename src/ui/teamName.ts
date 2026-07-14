// ---------------------------------------------------------------------------
// teamDisplayName (Stage 30.12b) — turn a partnership's SEATS into a human label
// built from the players' names ("Alex & Dina"), with graceful fallbacks. Used by
// the lobby team grid + Tarneeb/Deberc pair UIs so partners read as a named team
// instead of an abstract "Team A/B". PURE (no React) — takes a `t` for the i18n
// fallbacks. Solo modes never call this (they show individual player names).
//
// Team layout in every pairs game on the platform: Team 0 = seats 0 & 2,
// Team 1 = seats 1 & 3 (partners sit opposite).
// ---------------------------------------------------------------------------

/** The two seats of a pairs-game team (0 → [0,2], 1 → [1,3]). */
export function pairTeamSeats(team: 0 | 1): [number, number] {
  return team === 0 ? [0, 2] : [1, 3];
}

/**
 * A team label from its seats' player names:
 *  - two names known  → `"Alex & Dina"`
 *  - one name known   → `t('team.named')` → e.g. `"Team Alex"`
 *  - none known (yet) → the localized fallback (`fallbackKey`, e.g. `lobby.teamA`).
 * Blank / missing names (empty seats, unnamed bots) are skipped, so a partly-filled
 * team still reads sensibly.
 */
export function teamDisplayName(
  seats: readonly number[],
  nameOf: (seat: number) => string | null | undefined,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  const names = seats
    .map(nameOf)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim());
  if (names.length >= 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 1) return t('team.named').replace('{name}', names[0]);
  return t(fallbackKey);
}
