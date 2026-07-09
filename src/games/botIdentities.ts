// ---------------------------------------------------------------------------
// Bot identities (Stage 13.6) — deterministic names + varied avatars.
//
// Replaces the faceless "Bot 1 / Bot 2 / Bot 3" with lively-but-clearly-AI seats.
// PURE data + functions (no React, no Math.random, no I/O) so the SAME
// (seed, index) always yields the SAME name + avatar — safe to call in the UI and
// stable across reconnect/restore (the server stores the assigned name/avatar on
// the member, so identities are never re-rolled).
//
// A bot stays EXPLICITLY a bot: every display name carries the `" AI"` suffix
// (e.g. "Mira AI"), on top of the existing lobby/seat AI badge. Names are NOT
// translated (they read the same in every language). Avatars reuse the existing
// emoji whitelist (src/core/avatars) — no new assets.
// ---------------------------------------------------------------------------

import { AVATARS } from '../core/avatars';

/** Short, neutral first names (safe for EN/UK/DE/AR UI; no brands/offensive/long). */
export const BOT_NAME_POOL: readonly string[] = [
  'Mira', 'Niko', 'Zoya', 'Omar', 'Lina', 'Samir', 'Ada', 'Rami',
  'Yara', 'Enzo', 'Nina', 'Kai', 'Sana', 'Leo', 'Dina', 'Theo',
  'Maya', 'Aziz', 'Vera', 'Ravi', 'Ivy', 'Noor', 'Emre', 'Luca',
  'Aria', 'Sami', 'Nadia', 'Bruno', 'Elif', 'Tariq', 'Suri', 'Marco',
];

/** The visible marker that keeps every bot explicitly an AI (not translated). */
export const BOT_NAME_SUFFIX = 'AI';

export interface BotIdentity {
  /** e.g. "Mira AI" — always suffixed so a bot reads as a bot everywhere. */
  name: string;
  /** A whitelisted emoji from src/core/avatars.AVATARS. */
  avatar: string;
}

/** Base pool entry → the bot's display name ("<base> AI"). */
export function botDisplayName(base: string): string {
  return `${base} ${BOT_NAME_SUFFIX}`;
}

/** FNV-1a 32-bit hash → non-negative int. Pure/deterministic (no deps). */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic identity for `(seed, index)`: same inputs → same name + avatar.
 * `seed` groups a context (e.g. `"<roomCode>:<gameType>"` online, or the game type
 * locally); `index` varies it per bot / seat. Never random — safe in the UI.
 */
export function botIdentity(seed: string, index: number): BotIdentity {
  const h = hash(`${seed}#${index}`);
  return {
    name: botDisplayName(BOT_NAME_POOL[h % BOT_NAME_POOL.length]),
    avatar: AVATARS[Math.floor(h / BOT_NAME_POOL.length) % AVATARS.length],
  };
}

/**
 * Like {@link botIdentity} but linear-probes forward through the pools to avoid a
 * name/avatar already taken (e.g. by a human or an earlier bot in the same room).
 * Still fully deterministic for the same inputs. If a pool is exhausted it falls
 * back to a (possibly duplicate) pick rather than looping forever.
 */
export function nextBotIdentity(
  seed: string,
  index: number,
  takenNames: ReadonlySet<string> = new Set(),
  takenAvatars: ReadonlySet<string> = new Set(),
): BotIdentity {
  const h = hash(`${seed}#${index}`);
  const nameBase = h % BOT_NAME_POOL.length;
  const avaBase = Math.floor(h / BOT_NAME_POOL.length) % AVATARS.length;

  let name = botDisplayName(BOT_NAME_POOL[nameBase]);
  for (let k = 1; k < BOT_NAME_POOL.length && takenNames.has(name); k++) {
    name = botDisplayName(BOT_NAME_POOL[(nameBase + k) % BOT_NAME_POOL.length]);
  }
  let avatar = AVATARS[avaBase];
  for (let k = 1; k < AVATARS.length && takenAvatars.has(avatar); k++) {
    avatar = AVATARS[(avaBase + k) % AVATARS.length];
  }
  return { name, avatar };
}

/**
 * Distinct bot NAMES for a local game (games whose state has no avatar field):
 * `count` names, deduped against each other and any `taken` (e.g. the human's).
 */
export function localBotNames(seed: string, count: number, taken: Iterable<string> = []): string[] {
  const seen = new Set(taken);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const { name } = nextBotIdentity(seed, i, seen);
    names.push(name);
    seen.add(name);
  }
  return names;
}
