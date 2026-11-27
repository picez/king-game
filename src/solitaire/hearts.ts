// ---------------------------------------------------------------------------
// Hearts («Черві») — you (seat 0) against three bots (S5). One more variant of
// the solitaire Engine contract: the bots are DETERMINISTIC and play inside
// `apply`, so a whole game is still `seed + your moves` and the server can
// replay it to rank a win.
//
// Rules: 52 cards, 13 each. Before each hand pass 3 cards — left, right, across,
// then no pass, repeating. The 2♣ leads the first trick; follow suit if you can.
// No hearts and no Q♠ on the first trick unless you have nothing else. Hearts
// cannot be led until one has been played (unless only hearts are left). Each
// heart = 1 point, Q♠ = 13. Taking all 26 = "shooting the moon": 0 for you,
// 26 for everyone else. The game ends when someone reaches 100; lowest score wins.
// ---------------------------------------------------------------------------

import { buildDeck, shuffle, type SCard } from './cards';
import type { Engine, HeartsMove } from './engine';

export const HEARTS_TARGET = 100;
export const PASS_DIRS = ['left', 'right', 'across', 'none'] as const;
export type PassDir = typeof PASS_DIRS[number];

export interface TrickPlay { seat: number; card: SCard }

export interface HeartsState {
  /** hands[0] is the human; cards are face up only for seat 0 in the UI. */
  hands: SCard[][];
  phase: 'pass' | 'play' | 'over';
  hand: number;
  trick: TrickPlay[];
  /** The completed trick just before (display only) and who took it. */
  lastTrick: { plays: TrickPlay[]; winner: number } | null;
  turn: number;
  heartsBroken: boolean;
  /** Tricks played this hand (0 = the 2♣ trick). */
  trickNo: number;
  /** Points taken this hand per seat. */
  taken: number[];
  scores: number[];
  /** Times each seat shot the moon. */
  moons: number[];
  /** Cards the human received in the last pass (display only). */
  received: number[];
  seed: number;
}

const isQS = (c: SCard) => c.suit === 'spades' && c.rank === 12;
const is2C = (c: SCard) => c.suit === 'clubs' && c.rank === 2;
/** Ace high: 2 … 13 King, 14 Ace. */
const power = (c: SCard) => (c.rank === 1 ? 14 : c.rank);
export const points = (c: SCard) => (c.suit === 'hearts' ? 1 : isQS(c) ? 13 : 0);
const sortHand = (h: SCard[]) => [...h].sort((a, b) => (a.suit === b.suit ? power(a) - power(b) : SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]));
const SUIT_ORDER: Record<SCard['suit'], number> = { clubs: 0, diamonds: 1, spades: 2, hearts: 3 };

export const passDirOf = (hand: number): PassDir => PASS_DIRS[hand % 4];
/** The seat that receives a pass from `seat`. Seats go clockwise: 0 you, 1 left, 2 across, 3 right. */
export function passTarget(seat: number, dir: PassDir): number {
  return dir === 'left' ? (seat + 1) % 4 : dir === 'right' ? (seat + 3) % 4 : dir === 'across' ? (seat + 2) % 4 : seat;
}

function dealHand(seed: number, hand: number): SCard[][] {
  const deck = shuffle(buildDeck(1), (seed + hand * 7919) >>> 0).map((c) => ({ ...c, up: true }));
  return [0, 1, 2, 3].map((s) => sortHand(deck.slice(s * 13, s * 13 + 13)));
}

// ── legality ────────────────────────────────────────────────────────────────

export function legalCards(s: HeartsState, seat: number): SCard[] {
  const hand = s.hands[seat];
  if (s.phase !== 'play' || s.turn !== seat) return [];
  if (s.trick.length === 0) {
    if (s.trickNo === 0) return hand.filter(is2C);
    const nonHearts = hand.filter((c) => c.suit !== 'hearts');
    return s.heartsBroken || nonHearts.length === 0 ? hand : nonHearts;
  }
  const led = s.trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === led);
  if (follow.length) return follow;
  if (s.trickNo === 0) {
    const clean = hand.filter((c) => points(c) === 0);
    if (clean.length) return clean;
  }
  return hand;
}

function trickWinner(trick: TrickPlay[]): number {
  const led = trick[0].card.suit;
  let best = trick[0];
  for (const p of trick) if (p.card.suit === led && power(p.card) > power(best.card)) best = p;
  return best.seat;
}

// ── bots (deterministic) ────────────────────────────────────────────────────

/** The 3 cards a bot passes: Q♠ / high spades, then high hearts, then the highest cards. */
export function botPass(hand: SCard[]): SCard[] {
  const score = (c: SCard) => {
    if (isQS(c)) return 100;
    if (c.suit === 'spades' && power(c) > 12) return 90 + power(c);
    if (c.suit === 'hearts') return 40 + power(c);
    return power(c);
  };
  return [...hand].sort((a, b) => score(b) - score(a) || a.id - b.id).slice(0, 3);
}

/** A bot's card: duck under the winner when following, dump Q♠/hearts when void. */
export function botPlay(s: HeartsState, seat: number): SCard {
  const legal = legalCards(s, seat);
  const low = (cs: SCard[]) => [...cs].sort((a, b) => power(a) - power(b) || a.id - b.id)[0];
  const high = (cs: SCard[]) => [...cs].sort((a, b) => power(b) - power(a) || a.id - b.id)[0];
  if (legal.length === 1) return legal[0];
  if (s.trick.length === 0) {
    // Lead low from the suit with the most cards, avoiding spades while holding Q♠.
    const hasQ = s.hands[seat].some(isQS);
    const pool = legal.filter((c) => !(hasQ && c.suit === 'spades') && !(c.suit === 'hearts' && legal.some((x) => x.suit !== 'hearts')));
    return low(pool.length ? pool : legal);
  }
  const led = s.trick[0].card.suit;
  const following = legal[0].suit === led;
  const pts = s.trick.reduce((n, p) => n + points(p.card), 0);
  if (following) {
    const top = s.trick.filter((p) => p.card.suit === led).reduce((m, p) => Math.max(m, power(p.card)), 0);
    const under = legal.filter((c) => power(c) < top);
    if (under.length) return high(under);                 // highest card that still loses
    if (s.trick.length === 3 && pts === 0) {
      const safe = legal.filter((c) => !isQS(c));
      return high(safe.length ? safe : legal);            // last to play on a clean trick: win it high
    }
    const notQ = legal.filter((c) => !isQS(c));
    return low(notQ.length ? notQ : legal);
  }
  // Void in the led suit: dump the worst card.
  const q = legal.find(isQS);
  if (q) return q;
  const hearts = legal.filter((c) => c.suit === 'hearts');
  if (hearts.length) return high(hearts);
  return high(legal);
}

// ── flow ────────────────────────────────────────────────────────────────────

function startHand(s: HeartsState, hand: number): HeartsState {
  const hands = dealHand(s.seed, hand);
  const next: HeartsState = {
    ...s, hands, hand, trick: [], lastTrick: s.lastTrick, heartsBroken: false, trickNo: 0,
    taken: [0, 0, 0, 0], received: [], phase: passDirOf(hand) === 'none' ? 'play' : 'pass', turn: 0,
  };
  return next.phase === 'play' ? beginPlay(next) : next;
}

function beginPlay(s: HeartsState): HeartsState {
  const leader = s.hands.findIndex((h) => h.some(is2C));
  return runBots({ ...s, phase: 'play', turn: leader });
}

function playCard(s: HeartsState, seat: number, card: SCard): HeartsState {
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => c.id !== card.id) : h));
  const trick = [...s.trick, { seat, card }];
  const heartsBroken = s.heartsBroken || card.suit === 'hearts';
  if (trick.length < 4) return { ...s, hands, trick, heartsBroken, turn: (seat + 1) % 4 };
  const winner = trickWinner(trick);
  const taken = s.taken.map((t, i) => (i === winner ? t + trick.reduce((n, p) => n + points(p.card), 0) : t));
  const done: HeartsState = { ...s, hands, trick: [], lastTrick: { plays: trick, winner }, heartsBroken, turn: winner, taken, trickNo: s.trickNo + 1 };
  return done.trickNo === 13 ? endHand(done) : done;
}

function endHand(s: HeartsState): HeartsState {
  const moon = s.taken.findIndex((t) => t === 26);
  const add = moon >= 0 ? s.taken.map((_, i) => (i === moon ? 0 : 26)) : s.taken;
  const scores = s.scores.map((v, i) => v + add[i]);
  const moons = s.moons.map((m, i) => (i === moon ? m + 1 : m));
  const after: HeartsState = { ...s, scores, moons };
  if (scores.some((v) => v >= HEARTS_TARGET)) return { ...after, phase: 'over', trick: [], hands: [[], [], [], []] };
  return startHand(after, s.hand + 1);
}

/** Lets the bots play until it is the human's turn (or the game is over). */
function runBots(s: HeartsState): HeartsState {
  let cur = s;
  for (let guard = 0; guard < 400 && cur.phase === 'play' && cur.turn !== 0; guard++) {
    cur = playCard(cur, cur.turn, botPlay(cur, cur.turn));
  }
  return cur;
}

function applyPass(s: HeartsState, ids: number[]): HeartsState | null {
  if (s.phase !== 'pass' || ids.length !== 3 || new Set(ids).size !== 3) return null;
  const mine = ids.map((id) => s.hands[0].find((c) => c.id === id));
  if (mine.some((c) => !c)) return null;
  const dir = passDirOf(s.hand);
  const out = s.hands.map((h, seat) => (seat === 0 ? (mine as SCard[]) : botPass(h)));
  const hands = s.hands.map((h, seat) => h.filter((c) => !out[seat].some((o) => o.id === c.id)));
  for (let seat = 0; seat < 4; seat++) hands[passTarget(seat, dir)].push(...out[seat]);
  const fromSeat = [0, 1, 2, 3].find((x) => passTarget(x, dir) === 0)!;
  return beginPlay({ ...s, hands: hands.map(sortHand), received: out[fromSeat].map((c) => c.id) });
}

// ── engine ──────────────────────────────────────────────────────────────────

export function dealHearts(seed: number): HeartsState {
  const base: HeartsState = {
    hands: [[], [], [], []], phase: 'pass', hand: 0, trick: [], lastTrick: null, turn: 0, heartsBroken: false,
    trickNo: 0, taken: [0, 0, 0, 0], scores: [0, 0, 0, 0], moons: [0, 0, 0, 0], received: [], seed: seed >>> 0,
  };
  return startHand(base, 0);
}

function combos3<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let a = 0; a < xs.length; a++) for (let b = a + 1; b < xs.length; b++) for (let c = b + 1; c < xs.length; c++) out.push([xs[a], xs[b], xs[c]]);
  return out;
}

const won = (s: HeartsState) => s.phase === 'over' && s.scores[0] === Math.min(...s.scores);

export const hearts: Engine<HeartsState, HeartsMove> = {
  key: 'hearts',
  deal: dealHearts,
  legal(s) {
    if (s.phase === 'pass') return combos3(s.hands[0]).map((cs) => ({ t: 'pass', ids: cs.map((c) => c.id) }));
    return legalCards(s, 0).map((c) => ({ t: 'play', id: c.id }));
  },
  apply(s, m) {
    if (m.t === 'pass') return Array.isArray(m.ids) ? applyPass(s, m.ids) : null;
    if (m.t !== 'play' || s.phase !== 'play' || s.turn !== 0) return null;
    const card = legalCards(s, 0).find((c) => c.id === m.id);
    if (!card) return null;
    return runBots(playCard(s, 0, card));
  },
  /** "Won" = the game is over and you have the lowest score (ties count). */
  won,
  hint(s) {
    if (s.phase === 'pass') return { t: 'pass', ids: botPass(s.hands[0]).map((c) => c.id) };
    if (s.phase !== 'play' || s.turn !== 0) return null;
    return { t: 'play', id: botPlay(s, 0).id };
  },
  canAutoFinish: () => false,
  finishStep: () => null,
  cardsLeft: (s) => s.hands[0].length,
  lost: (s) => s.phase === 'over' && !won(s),
};
