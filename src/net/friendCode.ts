// ---------------------------------------------------------------------------
// Friend code — PURE, dependency-free helpers (Stage 25.1).
//
// A friend code is a short, shareable, human-typable handle (`CM-A2B3-C4D5`) that lets
// signed-in accounts add each other WITHOUT exposing an email or allowing account
// enumeration. It is NOT a credential — it only lets someone SEND you a friend request,
// which you still accept/decline. This module is the shared normalize/validate/format
// layer (no DOM, no crypto); the server generates the random body (server/db/friends.ts).
// ---------------------------------------------------------------------------

/** Unambiguous alphabet (no 0/O/1/I/L/U) — matches the room-code spirit. 30 chars. */
export const FRIEND_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Product prefix, so a code reads as ours and is easy to spot when shared. */
export const FRIEND_CODE_PREFIX = 'CM';
/** The random body length (8 → 30^8 ≈ 6.5e11 codes). */
export const FRIEND_CODE_BODY_LEN = 8;

const BODY_RE = new RegExp(`^[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_BODY_LEN}}$`);

/** Formats a bare 8-char body into the canonical `CM-XXXX-XXXX`. */
export function formatFriendCode(body: string): string {
  return `${FRIEND_CODE_PREFIX}-${body.slice(0, 4)}-${body.slice(4, FRIEND_CODE_BODY_LEN)}`;
}

/**
 * Normalises any user-typed variant to the canonical `CM-XXXX-XXXX`, or null when it is
 * not a valid code. Tolerant of case, spaces, dashes, and a present/absent `CM` prefix:
 * `cm a2b3 c4d5`, `A2B3C4D5`, `CM-A2B3-C4D5` → `CM-A2B3-C4D5`.
 */
export function normalizeFriendCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, ''); // drop spaces/dashes/etc.
  if (s.length === FRIEND_CODE_BODY_LEN + FRIEND_CODE_PREFIX.length && s.startsWith(FRIEND_CODE_PREFIX)) {
    s = s.slice(FRIEND_CODE_PREFIX.length);
  }
  if (s.length !== FRIEND_CODE_BODY_LEN || !BODY_RE.test(s)) return null;
  return formatFriendCode(s);
}

/** Type-guard: is `v` a valid friend code (in any accepted form)? */
export function isValidFriendCode(v: unknown): v is string {
  return typeof v === 'string' && normalizeFriendCode(v) !== null;
}
