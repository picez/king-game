// ---------------------------------------------------------------------------
// Friend room-invite authorisation — PURE, dependency-free (Stage 25.2).
//
// The server gathers the facts (is the sender authenticated? in a room? are they
// accepted friends? is the target online?) and this function decides whether to forward
// a FRIEND_INVITE. Extracted so the authorisation is unit-testable without a DB, sockets,
// or WS plumbing. The room code is ALWAYS the sender's OWN room (never a client value),
// so a client can never invite someone into an arbitrary room.
// ---------------------------------------------------------------------------

export interface FriendInviteCheck {
  /** Server-resolved sender userId (null when the socket has no signed-in session). */
  senderUserId: string | null;
  /** The sender's CURRENT room code (null when they are not in a room). */
  senderRoomCode: string | null;
  /** The client-supplied target userId (validated here). */
  toUserId: unknown;
  /** DB: are sender + target accepted friends? */
  areFriends: boolean;
  /** Presence: does the target have a live authenticated socket on this instance? */
  targetOnline: boolean;
}

export type FriendInviteVerdict =
  | { ok: true; toUserId: string; code: string }
  | { ok: false; reason: 'unauthenticated' | 'not_in_room' | 'bad_target' | 'not_friends' | 'offline' };

/**
 * Map a failed-invite reason to a client ErrorCode for a non-fatal toast (Stage 25.7), or null
 * when the failure should stay silent (a malformed target / unauthenticated socket the UI can't
 * cause). Kept as string literals so this module stays dependency-free (no messages.ts import).
 */
export function inviteReasonToErrorCode(
  reason: Exclude<FriendInviteVerdict, { ok: true }>['reason'],
): 'FRIEND_NOT_ONLINE' | 'NOT_FRIENDS' | 'NOT_IN_ROOM' | null {
  switch (reason) {
    case 'offline': return 'FRIEND_NOT_ONLINE';
    case 'not_friends': return 'NOT_FRIENDS';
    case 'not_in_room': return 'NOT_IN_ROOM';
    default: return null; // unauthenticated / bad_target → not a user-actionable state
  }
}

/** Decide whether a FRIEND_INVITE may be delivered, and to whom / for which room. */
export function verifyFriendInvite(c: FriendInviteCheck): FriendInviteVerdict {
  if (!c.senderUserId) return { ok: false, reason: 'unauthenticated' };
  if (!c.senderRoomCode) return { ok: false, reason: 'not_in_room' };
  if (typeof c.toUserId !== 'string' || !c.toUserId || c.toUserId === c.senderUserId) {
    return { ok: false, reason: 'bad_target' };
  }
  if (!c.areFriends) return { ok: false, reason: 'not_friends' };
  if (!c.targetOnline) return { ok: false, reason: 'offline' };
  return { ok: true, toUserId: c.toUserId, code: c.senderRoomCode };
}
