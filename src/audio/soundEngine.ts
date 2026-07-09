// ---------------------------------------------------------------------------
// Minimal client-side sound engine (Stage 15.2).
//
// Plays a single manifest SFX by id, LAZILY — nothing is created, fetched, or
// decoded until the first `playSound()` call, so importing this module (or
// loading the app) never touches the audio hardware and never autoplays. The
// browser audio primitive (`HTMLAudioElement`) lives ONLY inside this module.
//
// This engine is intentionally tiny: in Stage 15.2 the ONLY caller is the
// Profile "Preview sound" button (an explicit user gesture). No card / game /
// chat / finish events are wired yet — that is Stage 15.4. It is also a hard
// no-op whenever it shouldn't make noise:
//   • preference is 'off'      (the default for everyone)
//   • the tab is hidden        (document.hidden)
//   • the id is unknown        (no manifest entry)
//   • the file fails to load   (play() rejects → swallowed)
//   • it was called too soon   (per-id throttle)
// A sound failure must NEVER break gameplay, so every path is wrapped/guarded
// and silently degrades to no-op.
//
// Testability: the browser boundary is injected via a `SoundEnv`. Tests pass a
// fake env (fake Audio, controllable `hidden`/`now`/preference) and assert the
// decision logic — they never require real audio playback.
// ---------------------------------------------------------------------------

import { getSoundAsset, type SoundId } from './soundAssets';
import { getSoundPreference } from './soundPreferenceStore';
import { soundTierVolume, type SoundPreference } from './soundPreference';

/** Minimum gap between two plays of the SAME id (ms) — throttles rapid repeats. */
export const SOUND_THROTTLE_MS = 120;

/** The minimal slice of HTMLAudioElement the engine needs (fake-able in tests). */
export interface AudioLike {
  src: string;
  volume: number;
  currentTime: number;
  canPlayType?(type: string): string;
  play(): Promise<void> | void;
}

/** The injectable browser boundary. Defaults to the real environment. */
export interface SoundEnv {
  /** Current sound preference (defaults to the live store value). */
  preference(): SoundPreference;
  /** True when playback should be suppressed (tab hidden). */
  isHidden(): boolean;
  /** Monotonic-ish clock in ms, for throttling. */
  now(): number;
  /** Create an audio element for a source (only called on cache miss). */
  createAudio(src: string): AudioLike;
}

// Per-id state, module-scoped so repeated plays reuse one element and share the
// throttle clock. Nothing here is populated until the first successful play.
const cache = new Map<string, AudioLike>();
const lastPlayed = new Map<string, number>();

/** WebM/Opus where supported (Chrome/Firefox/Android), else MP3 (Safari/iOS). */
function pickSrc(probe: AudioLike, webm: string, mp3: string): string {
  try {
    if (probe.canPlayType && probe.canPlayType('audio/webm; codecs="opus"') !== '') return webm;
  } catch { /* fall through to mp3 */ }
  return mp3;
}

function defaultEnv(): SoundEnv {
  return {
    preference: () => getSoundPreference(),
    isHidden: () => typeof document !== 'undefined' && document.hidden === true,
    now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
    createAudio: (src) => new Audio(src),
  };
}

/**
 * Play a manifest SFX by id. A hard no-op when muted, hidden, unknown, throttled,
 * or on any failure. Never throws. The ONLY wired caller in Stage 15.2 is the
 * Profile preview button.
 */
export function playSound(id: SoundId, env: SoundEnv = defaultEnv()): void {
  try {
    const pref = env.preference();
    if (pref === 'off') return;                 // muted (the default) → silent
    if (env.isHidden()) return;                 // backgrounded tab → silent
    const asset = getSoundAsset(id);
    if (!asset) return;                         // unknown id → silent

    const now = env.now();
    const last = lastPlayed.get(id);
    if (last !== undefined && now - last < SOUND_THROTTLE_MS) return; // throttle

    const volume = Math.max(0, Math.min(1, asset.volumeHint * soundTierVolume(pref)));
    if (volume <= 0) return;                    // subtle/full only; 0 → nothing to hear

    let el = cache.get(id);
    if (!el) {                                  // LAZY: first play for this id
      const probe = env.createAudio('');
      el = probe;
      el.src = pickSrc(probe, asset.srcWebm, asset.srcMp3);
      cache.set(id, el);
    }
    el.volume = volume;
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof (p as Promise<void>).then === 'function') {
      (p as Promise<void>).catch(() => { /* autoplay block / decode fail → silent */ });
    }
    lastPlayed.set(id, now);                     // only after we actually attempted
  } catch {
    /* any unexpected failure must never break the caller — degrade to no-op */
  }
}

/** Test-only: forget cached elements + throttle clocks between cases. */
export function __resetSoundEngineForTests(): void {
  cache.clear();
  lastPlayed.clear();
}
