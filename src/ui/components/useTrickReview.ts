import { useEffect, useRef, useState } from 'react';

/** The standard "look at the last card" pause after a trick resolves (Stage 27.0: 2 s everywhere). */
export const TRICK_REVIEW_MS = 2000;

/**
 * Freeze the just-completed trick on the felt for a beat so players can read the final card,
 * then release. Purely presentational and deterministic (a fixed local timer on the shared
 * server state) — it never changes game state, so online clients stay in sync.
 *
 * Detects a new completed trick by `completedTricks` growing while still `playing`, and holds the
 * last one for `reviewMs`. Used by Tarneeb / Preferans (which resolve the trick inside PLAY_CARD,
 * so there is no server trick_complete screen) for BOTH local and online.
 */
export function useTrickReview<T>(completedTricks: readonly T[], playing: boolean, reviewMs = TRICK_REVIEW_MS): T | null {
  const [review, setReview] = useState<T | null>(null);
  const prev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const n = completedTricks.length;
    if (n > prev.current && playing) {
      setReview(completedTricks[n - 1]);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setReview(null), reviewMs);
    }
    prev.current = n;
  }, [completedTricks, playing, reviewMs]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return review;
}
