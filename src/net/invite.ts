// ---------------------------------------------------------------------------
// Room invite links (Stage 18.1) — PURE, dependency-free URL helpers.
//
// An invite is just the shareable ROOM CODE carried in a same-origin query param:
// `<origin>/?room=<CODE>`. The room code is ALREADY the room's public join secret
// (shown in the lobby) — so an invite link carries NOTHING sensitive: no session
// token, no userId, no reconnect token, and never the ws URL or a custom-server
// address (invites always use the current browser origin). Opening such a link only
// PREFILLS the Join sheet; it never auto-joins. No React/DOM here → unit-testable.
// ---------------------------------------------------------------------------

/** The query parameter that carries a room code in an invite link. */
export const INVITE_ROOM_PARAM = 'room';

/**
 * Normalises a room code to the server's shape: uppercase A–Z/0–9 only, capped.
 * (Server codes are 4 chars; we tolerate up to 8 so a mistyped/padded value still
 * trims cleanly rather than erroring — the server is the final authority on join.)
 */
export function normalizeRoomCode(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/**
 * Builds a same-origin invite URL for a room: `<origin>/?room=<CODE>`. `origin` is
 * the BROWSER origin (e.g. `https://host`), never a ws URL or custom server. Returns
 * '' when the origin or code is blank/invalid, so callers can hide the control.
 */
export function buildInviteLink(origin: string | null | undefined, code: string | null | undefined): string {
  const c = normalizeRoomCode(code);
  const o = (origin ?? '').trim().replace(/\/+$/, '');
  if (!o || c.length < 4) return '';
  return `${o}/?${INVITE_ROOM_PARAM}=${c}`;
}

/**
 * Extracts a room code from a URL search string (`?room=ABCD` or `room=ABCD`),
 * normalised. Returns null when absent or too short. Ignores every other param.
 */
export function roomCodeFromQuery(search: string | null | undefined): string | null {
  if (!search) return null;
  try {
    const qs = search.startsWith('?') ? search.slice(1) : search;
    const raw = new URLSearchParams(qs).get(INVITE_ROOM_PARAM);
    const code = normalizeRoomCode(raw);
    return code.length >= 4 ? code : null;
  } catch {
    return null;
  }
}
