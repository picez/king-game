// ---------------------------------------------------------------------------
// Match result — pure model (Stage 42.1).
//
// Every game's finished screen describes its outcome as a list of seats (or two
// teams) with a PLACE; MatchResult.tsx lays them out as dealt cards. Nothing here
// decides who won — each game hands over its own engine verdict. No React/DOM.
// ---------------------------------------------------------------------------

import { BOT_AVATAR, sanitizeAvatar } from '../../core/avatars';

/** One finisher. `place` 1 = the winner group; equal places are a tie. */
export interface ResultSeat {
  key: string;
  name: string;
  /** Whitelisted emoji avatar, when the game state carries one. */
  avatar?: string;
  isMe?: boolean;
  place: number;
  /** The figure under the name: a score, a chip stack… */
  value?: string;
  /** A short tag under the value (e.g. "Fool", "Out"). */
  note?: string;
  /** 'lose' paints the card as the loser (the fool, a busted seat). */
  tone?: 'win' | 'lose' | 'neutral';
}

export interface ResultTeamMember { name: string; avatar?: string; isMe?: boolean }

export interface ResultTeam {
  key: string;
  label: string;
  members: ResultTeamMember[];
  value?: string;
  won: boolean;
}

/** The viewer's own result — drives the headline medallion and the celebration. */
export type ResultOutcome = 'win' | 'loss' | 'draw' | 'fool';

/**
 * Competition ranking ("1, 1, 3"): items sorted best-first get a place, ties share
 * it. `better(a, b)` < 0 when a ranks above b. Returns places in INPUT order.
 */
export function competitionPlaces<T>(items: readonly T[], better: (a: T, b: T) => number): number[] {
  const order = items.map((item, i) => ({ item, i })).sort((a, b) => better(a.item, b.item) || a.i - b.i);
  const places = new Array<number>(items.length);
  order.forEach((o, rank) => {
    const prev = order[rank - 1];
    places[o.i] = prev && better(prev.item, o.item) === 0 ? places[prev.i] : rank + 1;
  });
  return places;
}

/**
 * The index of the group holding `key` in an ordered list of groups (Durak's exit
 * order, Poker's elimination order — Stage 42.4), or -1 when it is in none.
 */
export function groupIndex<K>(groups: readonly (readonly K[])[] | undefined, key: K): number {
  return groups ? groups.findIndex((g) => g.includes(key)) : -1;
}

/**
 * The podium shows the top three as 2 · 1 · 3 — only when exactly ONE seat holds
 * first place (a single winner). Everyone else goes to the standings list.
 */
export function splitPodium(seats: readonly ResultSeat[]): { podium: ResultSeat[]; rest: ResultSeat[] } {
  const sorted = [...seats].sort((a, b) => a.place - b.place);
  const winners = sorted.filter((s) => s.place === 1);
  if (winners.length !== 1 || sorted.length < 2) return { podium: winners, rest: sorted.slice(winners.length) };
  const top = sorted.slice(0, Math.min(3, sorted.length));
  const podium = top.length === 3 ? [top[1], top[0], top[2]] : [top[1], top[0]];
  return { podium, rest: sorted.slice(top.length) };
}

/** A game player's avatar: 🤖 for bots, its whitelisted emoji, else the name's stable default. */
export function playerAvatar(p: { name: string; type?: string; avatar?: string }): string {
  return p.type === 'ai' ? BOT_AVATAR : sanitizeAvatar(p.avatar, p.name);
}
