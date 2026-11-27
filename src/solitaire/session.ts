// ---------------------------------------------------------------------------
// A solitaire game session (S2): pure. The current line of moves is the whole
// truth — the states are derived by replay, so a saved game is just
// {key, seed, moves} and the server can verify the very same list.
// ---------------------------------------------------------------------------

import { randomSeed } from '../core/rng';
import { isVariantKey, type Move, type VariantKey } from './engine';
import { engineFor } from './registry';

export interface Session {
  key: VariantKey;
  seed: number;
  /** UTC day when this is the deal of the day. */
  daily: string | null;
  /** states[0] = deal; states[i] = after moves[i-1]. */
  states: unknown[];
  moves: Move[];
  undos: number;
  hints: number;
  /** Milliseconds of play (paused while the page is hidden). */
  elapsedMs: number;
  /** Set when the result was recorded (won or given up). */
  finished: 'won' | null;
  /** Server start token (S3): only a deal started with one can be ranked. */
  token: string | null;
}

export function newSession(key: VariantKey, seed: number = randomSeed(), daily: string | null = null, token: string | null = null): Session {
  return { key, seed: seed >>> 0, daily, states: [engineFor(key).deal(seed >>> 0)], moves: [], undos: 0, hints: 0, elapsedMs: 0, finished: null, token };
}

export const current = (s: Session): unknown => s.states[s.states.length - 1];
export const isWon = (s: Session): boolean => engineFor(s.key).won(current(s));
export const started = (s: Session): boolean => s.moves.length > 0;

/** Applies a move; returns the same session object when the move is illegal. */
export function play(s: Session, m: Move): Session {
  if (s.finished) return s;
  const next = engineFor(s.key).apply(current(s), m);
  if (next === null) return s;
  const out: Session = { ...s, states: [...s.states, next], moves: [...s.moves, m] };
  return engineFor(s.key).won(next) ? { ...out, finished: 'won' } : out;
}

export function undo(s: Session): Session {
  if (s.finished || s.moves.length === 0) return s;
  return { ...s, states: s.states.slice(0, -1), moves: s.moves.slice(0, -1), undos: s.undos + 1 };
}

/** Same deal from the start (the clock and counters keep running — it is one attempt). */
export function restart(s: Session): Session {
  if (s.finished) return s;
  return { ...s, states: [s.states[0]], moves: [], undos: s.undos + s.moves.length };
}

export function hint(s: Session): { session: Session; move: Move | null } {
  const move = engineFor(s.key).hint(current(s));
  return { session: move ? { ...s, hints: s.hints + 1 } : s, move };
}

/** Plays the auto-finish to the end (only when the engine says it is safe). */
export function autoFinish(s: Session): Session {
  const e = engineFor(s.key);
  if (!e.canAutoFinish(current(s))) return s;
  let out = s;
  for (let guard = 0; guard < 200 && !out.finished; guard++) {
    const m = e.finishStep(current(out));
    if (!m) break;
    const next = play(out, m);
    if (next === out) break;
    out = next;
  }
  return out;
}

export const tick = (s: Session, ms: number): Session => (s.finished || !started(s) || ms <= 0 ? s : { ...s, elapsedMs: s.elapsedMs + ms });

// ── persistence (in-progress game) ──────────────────────────────────────────

export interface SavedSession { v: 1; key: VariantKey; seed: number; daily: string | null; moves: Move[]; undos: number; hints: number; elapsedMs: number; token?: string | null }

export function toSaved(s: Session): SavedSession {
  return { v: 1, key: s.key, seed: s.seed, daily: s.daily, moves: s.moves, undos: s.undos, hints: s.hints, elapsedMs: s.elapsedMs, token: s.token };
}

/** Rebuilds a session from storage; null when the data is corrupt or stale. */
export function fromSaved(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SavedSession>;
  if (r.v !== 1 || !isVariantKey(r.key) || typeof r.seed !== 'number' || !Array.isArray(r.moves)) return null;
  let s = newSession(r.key, r.seed >>> 0, typeof r.daily === 'string' ? r.daily : null, typeof r.token === 'string' ? r.token : null);
  for (const m of r.moves) {
    const next = play(s, m as Move);
    if (next === s) return null;
    s = next;
  }
  if (s.finished) return null;
  return { ...s, undos: Number(r.undos) || 0, hints: Number(r.hints) || 0, elapsedMs: Math.max(0, Number(r.elapsedMs) || 0) };
}
