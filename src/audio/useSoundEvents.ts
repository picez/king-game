// ---------------------------------------------------------------------------
// Minimal P0 gameplay sound events (Stage 15.3).
//
// Client-side UI feedback ONLY. These hooks observe state THIS client already
// sees on screen and play a sound on the VISIBLE transition — they never read
// hidden information, never touch reducers/rules/server, and never change state.
// All playback still routes through the engine, so it is a no-op when the sound
// preference is off (the default), the tab is hidden, or a play is throttled.
//
// Two tiny signals cover every game's table (see soundEventsFor):
//   • tableCount   — how many cards are visible on the table / in the current
//                    trick right now. It INCREASES when a card is played
//                    (→ card-play) and DECREASES when the trick/bout is taken
//                    away (→ trick-collect). One number, both events.
//   • trumpVisible — whether the trump suit is revealed to this client. A
//                    false→true transition plays trump-reveal (games where trump
//                    is fixed & always visible, e.g. Durak, simply omit it).
//
// Dedupe: the decision core returns nothing until it has a PREVIOUS snapshot, so
// the first render (fresh mount, or a reconnect that arrives with the game
// already in progress) plays nothing — no historical burst. After that only
// single-step transitions fire, and the engine throttles same-id repeats.
//
// The pure decision functions (soundEventsFor / finishSoundFor) hold all the
// logic so they can be unit-tested in the node test env without a DOM; the hooks
// are thin ref-diffing wrappers.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { playSound } from './soundEngine';

/** The P0 in-trick event sounds (a subset of the manifest's SoundId union). */
export type P0EventSound = 'card-play' | 'trick-collect' | 'trump-reveal';
/** The finish-screen sounds. */
export type FinishSound = 'finish-win' | 'finish-neutral';

export interface GameSoundSignals {
  /** Cards visible on the table / in the current trick right now. */
  tableCount?: number;
  /** True when the trump suit is revealed to THIS client (omit if always visible). */
  trumpVisible?: boolean;
}

/**
 * Pure decision core: the sounds to play for a transition from `prev`→`next`.
 * Returns [] when there is no previous snapshot (mount / first-ready state), so
 * loading straight into an in-progress game never replays historical events.
 */
export function soundEventsFor(
  prev: GameSoundSignals | null,
  next: GameSoundSignals,
): P0EventSound[] {
  if (!prev) return []; // dedupe on mount / reconnect-into-progress
  const out: P0EventSound[] = [];
  if (typeof next.tableCount === 'number' && typeof prev.tableCount === 'number'
      && next.tableCount !== prev.tableCount) {
    out.push(next.tableCount > prev.tableCount ? 'card-play' : 'trick-collect');
  }
  if (next.trumpVisible === true && prev.trumpVisible === false) {
    out.push('trump-reveal');
  }
  return out;
}

/** Pure: the finish sound for a result — celebratory (win/teamWin) → win, else neutral. */
export function finishSoundFor(celebratory: boolean): FinishSound {
  return celebratory ? 'finish-win' : 'finish-neutral';
}

/**
 * Observe the visible table signals and play card-play / trick-collect /
 * trump-reveal on transitions. Safe to call every render — it diffs against the
 * previous snapshot and only plays on change (and never on the first render).
 */
export function useSoundEvents(signals: GameSoundSignals): void {
  const prev = useRef<GameSoundSignals | null>(null);
  useEffect(() => {
    for (const id of soundEventsFor(prev.current, signals)) playSound(id);
    prev.current = signals;
  }, [signals.tableCount, signals.trumpVisible]);
}

/**
 * Play the finish sound ONCE when a finished screen mounts. `celebratory` is the
 * viewer's result (win/teamWin → celebratory). Fixed at finish, so it is read at
 * mount time only and never replays on re-render.
 */
export function useFinishSound(celebratory: boolean): void {
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    playSound(finishSoundFor(celebratory));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- fire once per mount
}
