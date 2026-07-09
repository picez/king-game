// ---------------------------------------------------------------------------
// Client-only source of truth for the animation-intensity preference (Stage 13.2).
//
// A tiny external store (no context/provider needed, like cardBackStore) so any
// component can read the choice via useSyncExternalStore, AND — crucially — the
// CSS motion system picks up the RESOLVED intensity through a
// `data-motion-effective` attribute on <html> (see src/styles/motion.css).
//
// Two attributes are stamped:
//   • data-motion            — the raw user choice (system|full|reduced|off), for
//                              debugging/inspection; CSS does NOT key off it.
//   • data-motion-effective  — the resolved intensity (full|reduced|off) AFTER the
//                              OS `prefers-reduced-motion` override; CSS keys off this.
//
// Accessibility: we listen to the OS `prefers-reduced-motion` media query and
// recompute the effective value live, so a device that asks to reduce can never
// be forced into full motion (the existing @media guards remain as a safety net).
// Purely visual + LOCAL: never put into room/WS state. Initialised from
// localStorage on module load; the server profile (when signed in) rehydrates it
// via setMotionPreference.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import { loadMotionPreference } from '../../net/prefs';
import {
  normalizeMotionPreference, resolveEffectiveMotion,
  type AnimationPreference, type EffectiveMotion,
} from './motionPref';

const OS_REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

let pref: AnimationPreference = normalizeMotionPreference(loadMotionPreference());
let effective: EffectiveMotion = 'full';
const listeners = new Set<() => void>();

/** True when the OS asks to reduce motion. Guarded for non-DOM/test envs. */
function osReduce(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia(OS_REDUCE_QUERY).matches;
  } catch {
    return false;
  }
}

/** Reflect the choice + resolved intensity on <html> so the CSS can react. */
function applyDom(): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.motion = pref;
    document.documentElement.dataset.motionEffective = effective;
  }
}

/** Recompute the effective intensity, restamp the DOM, optionally notify React. */
function recompute(notify: boolean): void {
  effective = resolveEffectiveMotion(pref, osReduce());
  applyDom();
  if (notify) listeners.forEach((l) => l());
}

recompute(false); // stamp both attributes once, at first import

// React to OS-level reduced-motion changes so the accessibility override stays
// live (e.g. the user toggles "reduce motion" in system settings mid-session).
if (typeof window !== 'undefined' && window.matchMedia) {
  try {
    const mq = window.matchMedia(OS_REDUCE_QUERY);
    const onChange = () => recompute(true);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange); // older Safari
  } catch { /* non-fatal — the @media CSS guards still cover reduced-motion */ }
}

export function getMotionPreference(): AnimationPreference {
  return pref;
}

/** The resolved intensity currently applied (after the OS override). */
export function getEffectiveMotion(): EffectiveMotion {
  return effective;
}

/** Set the active preference (accepts unknown/legacy inputs) + notify subscribers. */
export function setMotionPreference(v: string | null | undefined): void {
  const next = normalizeMotionPreference(v);
  if (next === pref) return;
  pref = next;
  recompute(true);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React hook: re-renders the caller whenever the preference changes. */
export function useMotionPreference(): AnimationPreference {
  return useSyncExternalStore(subscribe, getMotionPreference, getMotionPreference);
}
