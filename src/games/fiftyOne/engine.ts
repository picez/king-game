// ---------------------------------------------------------------------------
// 51 — pure reducer. Deterministic (shuffle/deal/reshuffle via the injected
// rng), no browser or server APIs, no side effects. Illegal actions return the
// SAME state reference. Mirrors the reducer contract of the other five games.
//
// A normal turn is draw → (optional meld/add) → discard, enforced by
// `turnStep` (§5). The round ends the instant a player empties its hand on a
// discard (§11); scoring, elimination (§12) and the match-over check fold into
// that discard. See 51_RULES.md for every rule encoded here.
// ---------------------------------------------------------------------------

import type { Rng } from '../../core/rng';
import type { PlayerType } from '../../models/types';
import { dealFiftyOne, shuffleFiftyOne } from './deck';
import { resolveMeld } from './melds';
import {
  activeSeats,
  handPenalty,
  MAX_PLAYERS,
  MIN_PLAYERS,
  nextActiveSeat,
  normalizePlayerCount,
  normalizeTargetPenalty,
  OPENING_MINIMUM,
} from './rules';
import type {
  FiftyOneAction,
  FiftyOneCard,
  FiftyOneContext,
  FiftyOneMeld,
  FiftyOnePlayer,
  FiftyOneRoundResult,
  FiftyOneState,
} from './types';

function clone(state: FiftyOneState): FiftyOneState {
  return JSON.parse(JSON.stringify(state)) as FiftyOneState;
}

function resolveRng(ctx?: FiftyOneContext): Rng {
  return ctx?.rng ?? Math.random;
}

/** Pick the actual hand cards matching `requested` (by id); null if any is
 *  missing or requested twice. Does not mutate. */
function pickFromHand(hand: FiftyOneCard[], requested: FiftyOneCard[]): FiftyOneCard[] | null {
  const seen = new Set<string>();
  const out: FiftyOneCard[] = [];
  for (const req of requested) {
    if (seen.has(req.id)) return null;
    const found = hand.find((c) => c.id === req.id);
    if (!found) return null;
    seen.add(req.id);
    out.push(found);
  }
  return out;
}

function removeByIds(hand: FiftyOneCard[], ids: Set<string>): void {
  for (let i = hand.length - 1; i >= 0; i--) {
    if (ids.has(hand[i].id)) hand.splice(i, 1);
  }
}

// --- START_GAME -------------------------------------------------------------

function startGame(action: Extract<FiftyOneAction, { type: 'START_GAME' }>, rng: Rng): FiftyOneState | null {
  const playerCount = normalizePlayerCount(action.playerCount, action.playerNames.length);
  if (action.playerNames.length !== playerCount) return null; // names must match the seat count
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) return null;

  const players: FiftyOnePlayer[] = action.playerNames.map((name, seat) => ({
    id: `player-${seat}`,
    name,
    seatIndex: seat,
    type: (action.playerTypes?.[seat] ?? 'human') as PlayerType,
  }));

  const dealerSeat = action.dealerSeat ?? Math.floor(rng() * playerCount);

  const base: FiftyOneState = {
    gameType: 'fifty-one',
    phase: 'playing',
    playerCount,
    players,
    dealerSeat,
    starterSeat: dealerSeat, // set properly by dealRound
    currentSeat: dealerSeat,
    turnStep: 'meld_discard',
    handsBySeat: Array.from({ length: playerCount }, () => []),
    drawPile: [],
    discardPile: [],
    openedBySeat: Array.from({ length: playerCount }, () => false),
    publicMelds: [],
    scoresBySeat: Array.from({ length: playerCount }, () => 0),
    eliminatedSeats: Array.from({ length: playerCount }, () => false),
    roundNumber: 1,
    roundWinnerSeat: null,
    winnerSeat: null,
    lastRound: null,
    options: { targetPenalty: normalizeTargetPenalty(action.options?.targetPenalty) },
  };
  return dealRound(base, dealerSeat, rng, false);
}

/**
 * Deal a fresh round: the starter (dealer's clockwise neighbour) gets 14 cards,
 * every other active seat 13, the rest is the draw pile, the discard is empty.
 * The starter opens by discarding first, so the turn begins at 'meld_discard'
 * with no draw (§4). Scores/eliminations carry over untouched.
 */
function dealRound(base: FiftyOneState, dealerSeat: number, rng: Rng, incrementRound: boolean): FiftyOneState {
  const s = clone(base);
  s.dealerSeat = dealerSeat;
  const seats = activeSeats(s);
  const starter = nextActiveSeat(s, dealerSeat);
  s.starterSeat = starter;
  const deal = dealFiftyOne(s.playerCount, seats, starter, rng);
  s.handsBySeat = deal.handsBySeat;
  s.drawPile = deal.drawPile;
  s.discardPile = deal.discardPile;
  s.openedBySeat = Array.from({ length: s.playerCount }, () => false);
  s.publicMelds = [];
  s.currentSeat = starter;
  s.turnStep = 'meld_discard';
  s.phase = 'playing';
  s.roundWinnerSeat = null;
  if (incrementRound) s.roundNumber += 1;
  return s;
}

/** Refill an empty draw pile from the discard pile, keeping the top card (§5,
 *  MVP reshuffle). Returns false if there is nothing to reshuffle. Mutates s. */
function ensureDrawable(s: FiftyOneState, rng: Rng): boolean {
  if (s.drawPile.length > 0) return true;
  if (s.discardPile.length <= 1) return false; // only the (kept) top, or empty
  const top = s.discardPile[s.discardPile.length - 1];
  const rest = s.discardPile.slice(0, -1);
  s.drawPile = shuffleFiftyOne(rest, rng);
  s.discardPile = [top];
  return true;
}

// --- Scoring (§11, §12) -----------------------------------------------------

function scoreRound(s: FiftyOneState, roundWinner: number): FiftyOneState {
  const penaltyBySeat = Array.from({ length: s.playerCount }, () => 0);
  const neverOpenedBySeat = Array.from({ length: s.playerCount }, () => false);

  for (let seat = 0; seat < s.playerCount; seat++) {
    if (s.eliminatedSeats[seat] || seat === roundWinner) continue;
    const opened = s.openedBySeat[seat];
    neverOpenedBySeat[seat] = !opened;
    const p = handPenalty(s.handsBySeat[seat], opened);
    penaltyBySeat[seat] = p;
    s.scoresBySeat[seat] += p;
  }

  const target = s.options.targetPenalty;
  const newlyEliminated: number[] = [];
  for (let seat = 0; seat < s.playerCount; seat++) {
    if (!s.eliminatedSeats[seat] && s.scoresBySeat[seat] >= target) {
      s.eliminatedSeats[seat] = true;
      newlyEliminated.push(seat);
    }
  }

  s.roundWinnerSeat = roundWinner;
  const result: FiftyOneRoundResult = {
    roundNumber: s.roundNumber,
    winnerSeat: roundWinner,
    penaltyBySeat,
    neverOpenedBySeat,
    newlyEliminated,
  };
  s.lastRound = result;

  const remaining = activeSeats(s);
  if (remaining.length <= 1) {
    s.phase = 'game_finished';
    // Last seat standing wins; if a freak simultaneous wipe leaves none, the
    // lowest running penalty wins (ties → lowest seat index).
    if (remaining.length === 1) {
      s.winnerSeat = remaining[0];
    } else {
      let best = 0;
      for (let seat = 1; seat < s.playerCount; seat++) {
        if (s.scoresBySeat[seat] < s.scoresBySeat[best]) best = seat;
      }
      s.winnerSeat = best;
    }
    return s;
  }
  s.phase = 'round_complete';
  return s;
}

// --- Reducer ----------------------------------------------------------------

export function fiftyOneReducer(
  state: FiftyOneState | null,
  action: FiftyOneAction,
  ctx?: FiftyOneContext,
): FiftyOneState | null {
  const rng = resolveRng(ctx);

  if (action.type === 'START_GAME') {
    if (state !== null) return state; // already started → illegal
    return startGame(action, rng);
  }

  if (state === null) return null;
  if (state.phase === 'game_finished') return state;

  const seat = state.currentSeat;

  switch (action.type) {
    case 'DRAW_FROM_DECK': {
      if (state.phase !== 'playing' || state.turnStep !== 'draw') return state;
      const s = clone(state);
      if (!ensureDrawable(s, rng)) return state; // no card to draw → illegal no-op
      const card = s.drawPile.pop() as FiftyOneCard;
      s.handsBySeat[seat].push(card);
      s.turnStep = 'meld_discard';
      return s;
    }

    case 'TAKE_DISCARD': {
      if (state.phase !== 'playing' || state.turnStep !== 'draw') return state;
      if (!state.openedBySeat[seat]) return state;       // discard take is open-gated (§5)
      if (state.discardPile.length === 0) return state;
      const s = clone(state);
      const card = s.discardPile.pop() as FiftyOneCard;
      s.handsBySeat[seat].push(card);
      s.turnStep = 'meld_discard';
      return s;
    }

    case 'TAKE_DISCARD_AND_OPEN': {
      // An UNOPENED seat may take the discard top ONLY to open with it in the SAME
      // action: the top must be part of the opening melds, which must total ≥ 51 and
      // leave ≥ 1 card to discard (§5/§7, owner rule 30.13). Never "just into hand".
      if (state.phase !== 'playing' || state.turnStep !== 'draw') return state;
      if (state.openedBySeat[seat]) return state;        // opened → use TAKE_DISCARD
      if (state.discardPile.length === 0) return state;
      const melds = action.melds;
      if (!Array.isArray(melds) || melds.length === 0) return state;

      const top = state.discardPile[state.discardPile.length - 1];
      const hand = state.handsBySeat[seat];
      const pool = [...hand, top];                       // the top is available to open with
      const usedIds = new Set<string>();
      const resolved = [] as ReturnType<typeof resolveMeld>[];
      let total = 0;
      for (const meldCards of melds) {
        const picked = pickFromHand(pool, meldCards);
        if (!picked || picked.length < 3) return state;
        for (const c of picked) {
          if (usedIds.has(c.id)) return state;           // a card can't be in two melds
          usedIds.add(c.id);
        }
        const r = resolveMeld(picked);
        if (!r) return state;
        resolved.push(r);
        total += r.value;
      }
      if (!usedIds.has(top.id)) return state;            // the taken card MUST be used to open
      if (total < OPENING_MINIMUM) return state;         // opening must reach 51 (§7)
      if (pool.length - usedIds.size < 1) return state;  // must keep a card to discard (§5)

      const s = clone(state);
      s.discardPile.pop();                               // remove the top from the discard pile
      s.handsBySeat[seat].push(top);                     // fold it into the hand, then strip melds
      removeByIds(s.handsBySeat[seat], usedIds);         // removes the used cards (incl. the top)
      for (const r of resolved) {
        const meld: FiftyOneMeld = {
          id: `m-${s.roundNumber}-${seat}-${s.publicMelds.length}`,
          ownerSeat: seat,
          type: r!.type,
          cards: r!.cards,
          jokerRepresents: r!.jokerRepresents,
          value: r!.value,
        };
        s.publicMelds.push(meld);
      }
      s.openedBySeat[seat] = true;
      s.turnStep = 'meld_discard';                       // now the player must discard to end the turn
      return s;
    }

    case 'OPEN_MELDS': {
      // Lays one or more valid melds. BEFORE opening, the combined value must reach
      // 51 (the opening rule, §7); this also flips the seat to "opened". AFTER opening
      // (once per round), the same action lays any valid meld with NO 51 gate (§7/§9,
      // owner rule 30.9) — the seat stays opened.
      if (state.phase !== 'playing' || state.turnStep !== 'meld_discard') return state;
      const alreadyOpen = state.openedBySeat[seat];
      const melds = action.melds;
      if (!Array.isArray(melds) || melds.length === 0) return state;

      const hand = state.handsBySeat[seat];
      const usedIds = new Set<string>();
      const resolved = [] as ReturnType<typeof resolveMeld>[];
      let total = 0;
      for (const meldCards of melds) {
        const picked = pickFromHand(hand, meldCards);
        if (!picked || picked.length < 3) return state;
        for (const c of picked) {
          if (usedIds.has(c.id)) return state;           // a card can't be in two melds
          usedIds.add(c.id);
        }
        const r = resolveMeld(picked);
        if (!r) return state;
        resolved.push(r);
        total += r.value;
      }
      if (!alreadyOpen && total < OPENING_MINIMUM) return state; // opening must reach 51 (§7)
      if (hand.length - usedIds.size < 1) return state;  // must keep a card to discard (§5)

      const s = clone(state);
      removeByIds(s.handsBySeat[seat], usedIds);
      for (const r of resolved) {
        const meld: FiftyOneMeld = {
          id: `m-${s.roundNumber}-${seat}-${s.publicMelds.length}`,
          ownerSeat: seat,
          type: r!.type,
          cards: r!.cards,
          jokerRepresents: r!.jokerRepresents,
          value: r!.value,
        };
        s.publicMelds.push(meld);
      }
      s.openedBySeat[seat] = true;
      return s; // still meld_discard — the player must discard to end the turn
    }

    case 'ADD_TO_MELD': {
      if (state.phase !== 'playing' || state.turnStep !== 'meld_discard') return state;
      if (!state.openedBySeat[seat]) return state;       // lay-off is open-gated (§9)
      const meldIdx = state.publicMelds.findIndex((m) => m.id === action.meldId);
      if (meldIdx < 0) return state;
      const hand = state.handsBySeat[seat];
      const picked = pickFromHand(hand, action.cards);
      if (!picked || picked.length === 0) return state;
      if (hand.length - picked.length < 1) return state; // must keep a card to discard

      const meld = state.publicMelds[meldIdx];
      const combined = [...meld.cards, ...picked];
      const r = resolveMeld(combined);
      if (!r) return state;                              // must stay a legal meld (§9)

      const s = clone(state);
      removeByIds(s.handsBySeat[seat], new Set(picked.map((c) => c.id)));
      s.publicMelds[meldIdx] = { ...meld, type: r.type, cards: r.cards, jokerRepresents: r.jokerRepresents, value: r.value };
      return s;
    }

    case 'REPLACE_JOKER': {
      // Swap a real card from hand for a joker in a PUBLIC meld and take that joker
      // into hand (§9a, owner rule 30.14). Open-gated exactly like the lay-off: an
      // unopened seat may never touch a public meld. The replacement must match the
      // joker's represented rank+suit EXACTLY, so the meld's cards/value are
      // unchanged in every respect but the physical card — it stays valid by
      // construction, and we re-resolve to prove it rather than assume it.
      if (state.phase !== 'playing' || state.turnStep !== 'meld_discard') return state;
      if (!state.openedBySeat[seat]) return state;       // joker take-back is open-gated (§9a)
      const meldIdx = state.publicMelds.findIndex((m) => m.id === action.meldId);
      if (meldIdx < 0) return state;
      const meld = state.publicMelds[meldIdx];

      const jokerIdx = meld.cards.findIndex((cd) => cd.id === action.jokerCardId);
      if (jokerIdx < 0) return state;
      const joker = meld.cards[jokerIdx];
      if (!joker.joker) return state;                    // the target must BE a joker
      const represents = meld.jokerRepresents[jokerIdx];
      if (!represents) return state;                     // no represented card ⇒ nothing to match

      const hand = state.handsBySeat[seat];
      const picked = pickFromHand(hand, [action.card]);
      if (!picked) return state;                         // the card must be in your hand
      const replacement = picked[0];
      if (replacement.joker) return state;               // a joker may not replace a joker
      if (replacement.suit !== represents.suit || replacement.rank !== represents.rank) return state;

      const cards = meld.cards.slice();
      cards[jokerIdx] = replacement;                     // the joker's slot, same position
      const r = resolveMeld(cards);
      if (!r) return state;                              // must stay a legal meld (§9)

      const s = clone(state);
      removeByIds(s.handsBySeat[seat], new Set([replacement.id]));
      s.handsBySeat[seat].push(joker);                   // the joker goes to your hand (25 if left there, §11)
      s.publicMelds[meldIdx] = { ...meld, type: r.type, cards: r.cards, jokerRepresents: r.jokerRepresents, value: r.value };
      // The swap is hand-size neutral (one card out, the joker in), so it can never
      // empty a hand — the turn still ends on a discard (§5), never on this action.
      return s;
    }

    case 'DISCARD': {
      if (state.phase !== 'playing' || state.turnStep !== 'meld_discard') return state;
      const hand = state.handsBySeat[seat];
      const found = hand.find((c) => c.id === action.card.id);
      if (!found) return state;
      const s = clone(state);
      removeByIds(s.handsBySeat[seat], new Set([found.id]));
      s.discardPile.push(found);
      if (s.handsBySeat[seat].length === 0) {
        return scoreRound(s, seat);                      // emptied hand → round win (§11)
      }
      s.currentSeat = nextActiveSeat(s, seat);
      s.turnStep = 'draw';
      return s;
    }

    case 'START_NEXT_ROUND': {
      if (state.phase !== 'round_complete') return state;
      const s = clone(state);
      const nextDealer = nextActiveSeat(s, s.dealerSeat);
      return dealRound(s, nextDealer, rng, true);
    }

    default:
      return state;
  }
}
