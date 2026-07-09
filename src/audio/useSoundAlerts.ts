// ---------------------------------------------------------------------------
// Sound as a USEFUL ALERT, not atmosphere (Stage 15.4).
//
// Product decision: Card Majlis sound is attention/alert only — we removed the
// Stage 15.3 decorative cues (card-play / trick-collect / trump-reveal / finish).
// What remains is a single low-time warning: when it is MY active turn and my
// turn timer drops below the threshold, play ONE short alert.
//
// Client-side UI feedback ONLY — no reducers/rules/server/state, no hidden info
// (a turn timer is public). Routes through the engine, so it is a no-op when the
// sound preference is off (the default), the tab is hidden, or it is throttled.
//
// The alert reuses the existing `ui-error` SFX (a short, noticeable UI cue) — no
// new asset. A dedicated `timer-low` sound can be added later without touching
// this wiring.
//
// Anti-spam is the whole game here (see timerLowStep):
//   • fires ONCE per turn, exactly when the countdown CROSSES >threshold → ≤threshold
//   • never every tick; resets when the turn/step (turnKey) changes
//   • never for another player's turn (the caller passes `active` = "it's my turn")
//   • never on mount / reconnect into an already-low timer — a crossing needs a
//     previously-observed value ABOVE the threshold, which a fresh mount lacks
//
// The pure reducer (timerLowStep) holds all the logic so it is unit-testable in
// the node env; the hook is a thin ref wrapper.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { playSound } from './soundEngine';

/** Seconds at/under which the low-time alert should fire (once). */
export const TIMER_LOW_THRESHOLD_SEC = 10;
/**
 * The SFX used for the low-time alert — the existing `ui-error` UI cue (a valid
 * SoundId, so `playSound` typechecks without importing the manifest here). No new
 * asset; a dedicated `timer-low` can be swapped in later.
 */
export const TIMER_LOW_SOUND = 'ui-error' as const;

export interface TimerLowMemo {
  /** The turn/step this memo is tracking; a change resets prevLeft + fired. */
  turnKey: string | null;
  /** The previously observed secondsLeft for the current turn (null until seen). */
  prevLeft: number | null;
  /** Whether the alert already fired for the current turn. */
  fired: boolean;
}

export const TIMER_LOW_INITIAL: TimerLowMemo = { turnKey: null, prevLeft: null, fired: false };

export interface TimerLowInput {
  /** Seconds left on the (visible) turn countdown. */
  secondsLeft: number;
  /** True only when it is THIS client's turn and a timer is actually running. */
  active: boolean;
  /** Changes on every turn/step transition; resets the once-per-turn guard. */
  turnKey: string;
}

/**
 * Pure step: given the previous memo and the current input, return the next memo
 * and whether to play the alert THIS step. Plays iff — during my active turn, not
 * already fired this turn — the countdown crosses from above the threshold to
 * at/under it (and is still >0). A new turnKey resets tracking, so a mount /
 * reconnect that starts already-low never fires (no prior above-threshold value).
 */
export function timerLowStep(
  memo: TimerLowMemo,
  input: TimerLowInput,
): { memo: TimerLowMemo; play: boolean } {
  // New turn/step → forget the previous countdown and the fired flag.
  const base: TimerLowMemo = input.turnKey !== memo.turnKey
    ? { turnKey: input.turnKey, prevLeft: null, fired: false }
    : memo;

  const prev = base.prevLeft;
  const next: TimerLowMemo = { ...base, prevLeft: input.secondsLeft };

  const crossed = prev != null
    && prev > TIMER_LOW_THRESHOLD_SEC
    && input.secondsLeft <= TIMER_LOW_THRESHOLD_SEC
    && input.secondsLeft > 0;

  if (input.active && !base.fired && crossed) {
    return { memo: { ...next, fired: true }, play: true };
  }
  return { memo: next, play: false };
}

/**
 * Play a one-shot low-time alert when my turn timer crosses below the threshold.
 * Safe to call every render/tick — it diffs against a ref-held memo and only
 * plays on the genuine crossing. No-op when sound is off (the default).
 */
export function useTimerLowAlert(input: TimerLowInput): void {
  const memo = useRef<TimerLowMemo>(TIMER_LOW_INITIAL);
  useEffect(() => {
    const { memo: nextMemo, play } = timerLowStep(memo.current, input);
    memo.current = nextMemo;
    if (play) playSound(TIMER_LOW_SOUND);
  }, [input.secondsLeft, input.active, input.turnKey]);
}
