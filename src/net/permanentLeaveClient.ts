// ---------------------------------------------------------------------------
// Client-side permanent-leave lifecycle (Stage 38.0.5.1).
//
// Pure transitions, deliberately extracted from `useNetworkGame` so the two ordering
// rules that make the irreversible exit safe can be TESTED rather than described:
//
//  1. SINGLE FLIGHT. `useNetworkGame` used to gate the intent on React state alone
//     (`setPermanentLeave(p => …)`). React state is asynchronous: two presses in the
//     same tick — a double tap, a keyboard repeat, a re-fired click — both read the
//     stale `idle` and both put `LEAVE_GAME_PERMANENTLY` on the wire. The hook now
//     keeps a synchronous ref driven by `planLeaveIntent`, so the decision to send is
//     made from the value the PREVIOUS press already wrote.
//
//  2. THE ACK IS ABSORBING. `PERMANENT_LEAVE_ACCEPTED` is authoritative and terminal:
//     the seat is gone, the token is dead, the session is cleared. A refusal that
//     arrives AFTERWARDS (the server answering a duplicate intent, or a late error for
//     a request the ACK already superseded) must never repaint the UI as `error` — that
//     would tell the player the table is still theirs when it demonstrably is not.
//
// No I/O, no React: the hook maps these onto its ref + state, and nothing else may.
// ---------------------------------------------------------------------------

/** The client's view of its own permanent-leave request. */
export type PermanentLeaveStatus = 'idle' | 'pending' | 'accepted' | 'error';

/**
 * Decide what a press of "Quit for good" does.
 * `send: false` = swallow it: a request is already in flight, or the ACK already landed.
 */
export function planLeaveIntent(current: PermanentLeaveStatus): {
  send: boolean; next: PermanentLeaveStatus;
} {
  if (current === 'pending' || current === 'accepted') return { send: false, next: current };
  // `idle` and `error` may both start one: a refusal changed nothing server-side, so a
  // retry is legitimate (and the durable gate makes a duplicate loss impossible anyway).
  return { send: true, next: 'pending' };
}

/** The authoritative ACK. Terminal and absorbing — it can arrive in ANY state. */
export function applyLeaveAccepted(current: PermanentLeaveStatus): {
  changed: boolean; next: 'accepted';
} {
  return { changed: current !== 'accepted', next: 'accepted' };
}

/**
 * A `PERMANENT_LEAVE_UNAVAILABLE` refusal. `apply: false` means IGNORE it entirely:
 * the ACK already promised the departure completed, and a duplicate intent's refusal
 * must not overwrite that.
 */
export function applyLeaveRefusal(current: PermanentLeaveStatus): {
  apply: boolean; next: PermanentLeaveStatus;
} {
  if (current === 'accepted') return { apply: false, next: 'accepted' };
  return { apply: true, next: 'error' };
}
