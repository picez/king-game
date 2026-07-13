// ---------------------------------------------------------------------------
// Durak — pure reducer (Stage 9.1). Deterministic (shuffle via injected rng),
// no browser/server APIs. Illegal actions return the SAME state reference.
// Mirrors King's reducer contract but with Durak's own state/action. See
// DURAK_RULES.md for every rule encoded here.
// ---------------------------------------------------------------------------

import type { Card } from '../../models/types';
import type { DurakAction, DurakContext, DurakPlayer, DurakState } from './types';
import { dealDurak, findLowestTrumpHolder } from './deck';
import {
  beats, canTransfer, canTrumpShowTransfer, findNextActivePlayer, getValidAttackCards,
  getValidTransferCards, getValidTrumpShowCards, hasLegalThrowIn, sameCard,
} from './rules';

const MAX_HAND = 6;

function clone(state: DurakState): DurakState {
  return JSON.parse(JSON.stringify(state)) as DurakState; // pure JSON data → safe deep copy
}

function removeCard(hand: Card[], card: Card): void {
  const i = hand.findIndex((c) => sameCard(c, card));
  if (i >= 0) hand.splice(i, 1);
}

/** Refill hands to six after a bout: attacker(s) first (clockwise), defender last. */
function drawAfterBout(s: DurakState): void {
  const n = s.players.length;
  const order: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (s.attackerIndex + k) % n;
    if (i !== s.defenderIndex) order.push(i);
  }
  order.push(s.defenderIndex);
  for (const i of order) {
    while (s.players[i].hand.length < MAX_HAND && s.drawPile.length > 0) {
      s.players[i].hand.push(s.drawPile.shift()!);
    }
  }
}

/** End the game if the deck is empty and ≤1 player still holds cards. */
function checkFinished(s: DurakState): boolean {
  if (s.drawPile.length > 0) return false;
  const withCards = s.players.filter((p) => p.hand.length > 0);
  if (withCards.length > 1) return false;
  s.status = 'finished';
  if (withCards.length === 1) {
    s.foolId = withCards[0].id;
    s.isDraw = false;
    s.winnerIds = s.players.filter((p) => p.id !== withCards[0].id).map((p) => p.id);
  } else {
    s.foolId = null;
    s.isDraw = true;
    s.winnerIds = s.players.map((p) => p.id);
  }
  return true;
}

/**
 * After a bout resolves (draws already done), pick the next PRIMARY attacker
 * starting at `attackerFrom` (skipping `skip`), then the next defender, reset the
 * throw-in state, or finish the game.
 */
function rotateRoles(s: DurakState, attackerFrom: number, skip?: number): void {
  if (checkFinished(s)) return;
  const na = findNextActivePlayer(s, attackerFrom, skip);
  if (na === null) { checkFinished(s); return; }
  s.attackerIndex = na;
  const nd = findNextActivePlayer(s, na + 1, na);
  if (nd === null) { checkFinished(s); return; }
  s.defenderIndex = nd;
  s.throwerIndex = na;          // the primary attacker opens the new bout
  s.lastThrowerIndex = na;      // …and anchors the first throw-in cycle
  s.passedAttackers = [];
  s.boutLimit = Math.min(MAX_HAND, s.players[nd].hand.length);
  s.status = 'attack';
  // A fresh bout re-arms the one-time trump-show transfer (§3a) and clears its
  // public announcement.
  s.trumpShowUsed = false;
  s.lastTrumpShow = null;
}

/**
 * First non-passed eligible attacker (active, not the defender), clockwise from
 * the LAST thrower (inclusive) — i.e. whoever last added a card keeps priority.
 * Pure (no side effects).
 */
function firstThrower(s: DurakState): number | null {
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const i = (s.lastThrowerIndex + k) % n;
    if (i === s.defenderIndex) continue;
    if (s.players[i].hand.length === 0) continue;   // out of cards
    if (s.passedAttackers.includes(i)) continue;    // already passed this cycle
    return i;
  }
  return null;
}

/**
 * Throw-in priority (DURAK_RULES.md): after a card is beaten/added or an attacker
 * passes, hand the throw to the next eligible attacker who CAN throw, scanning
 * clockwise from the LAST thrower (auto-passing those who cannot — no matching
 * card / limit). When nobody can throw, the bout ends: a successful defense if the
 * defender was defending, or the defender finally TAKES if they chose to take.
 */
function continueThrowIn(s: DurakState, taking: boolean): void {
  for (;;) {
    const seat = firstThrower(s);
    if (seat === null) { taking ? finalizeTake(s) : resolveDefended(s); return; }
    if (hasLegalThrowIn(s, seat)) { s.throwerIndex = seat; s.status = taking ? 'taking' : 'attack'; return; }
    s.passedAttackers.push(seat); // cannot throw → treated as a pass; move on
  }
}

/** Successful defense: discard the table, draw up, and the defender leads next. */
function resolveDefended(s: DurakState): void {
  s.lastBout = s.table.map((p) => ({ ...p })); // display-only snapshot before clearing
  for (const p of s.table) { s.discardPile.push(p.attack); if (p.defense) s.discardPile.push(p.defense); }
  s.table = [];
  s.passedAttackers = [];
  const oldDefender = s.defenderIndex;
  drawAfterBout(s);
  rotateRoles(s, oldDefender, undefined); // the defender becomes the next primary attacker
}

/** Defender takes ALL table cards (after the take-phase throw-ins end); the player
 *  after the defender attacks next. */
function finalizeTake(s: DurakState): void {
  s.lastBout = s.table.map((p) => ({ ...p })); // display-only snapshot before clearing
  const taken: Card[] = [];
  for (const p of s.table) { taken.push(p.attack); if (p.defense) taken.push(p.defense); }
  s.players[s.defenderIndex].hand.push(...taken);
  s.table = [];
  const oldDefender = s.defenderIndex;
  drawAfterBout(s);
  rotateRoles(s, oldDefender + 1, oldDefender); // next attacker is AFTER the defender
}

function startDurak(action: Extract<DurakAction, { type: 'START_DURAK' }>, ctx?: DurakContext): DurakState | null {
  const numPlayers = action.playerNames.length;
  // Up to 5 players: the 36-card deck deals 6 each (5×6 = 30) and still leaves a
  // 6-card draw pile. Six players would deal the whole deck (no draw/trump), so 5
  // is the max (DURAK_RULES.md §6 lifts the earlier 4-player MVP cap).
  if (numPlayers < 2 || numPlayers > 5) return null;
  const rng = ctx?.rng ?? Math.random;
  const { hands, drawPile, trumpCard, trumpSuit } = dealDurak(numPlayers, rng);
  const players: DurakPlayer[] = action.playerNames.map((name, i) => ({
    id: `player-${i}`, name, seatIndex: i, type: action.playerTypes?.[i] ?? 'human', hand: hands[i],
  }));
  const attackerIndex = findLowestTrumpHolder(hands, trumpSuit) ?? 0; // fallback seat 0
  const defenderIndex = (attackerIndex + 1) % numPlayers;
  return {
    gameType: 'durak', variant: action.variant, players, drawPile, trumpSuit, trumpCard,
    attackerIndex, defenderIndex, throwerIndex: attackerIndex, lastThrowerIndex: attackerIndex,
    passedAttackers: [],
    table: [], discardPile: [], status: 'attack',
    boutLimit: Math.min(MAX_HAND, players[defenderIndex].hand.length),
    trumpShowUsed: false, lastTrumpShow: null,
    foolId: null, winnerIds: [], isDraw: false,
  };
}

export function durakReducer(
  state: DurakState | null,
  action: DurakAction,
  ctx?: DurakContext,
): DurakState | null {
  if (action.type === 'START_DURAK') {
    if (state !== null) return state; // already started → illegal
    return startDurak(action, ctx);
  }
  if (state === null) return null;
  if (state.status === 'finished') return state;

  switch (action.type) {
    case 'ATTACK_CARD': {
      if (state.status !== 'attack' && state.status !== 'taking') return state;
      if (!getValidAttackCards(state).some((c) => sameCard(c, action.card))) return state;
      const s = clone(state);
      removeCard(s.players[s.throwerIndex].hand, action.card); // the current thrower plays
      s.table.push({ attack: action.card, defense: null });
      // A newly added card opens a FRESH throw-in cycle anchored at THIS thrower:
      // once it is beaten they keep priority; passes clear so a new rank can re-open
      // a chance for earlier attackers. DURAK_RULES.md — last-thrower priority.
      s.lastThrowerIndex = s.throwerIndex;
      s.passedAttackers = [];
      if (state.status === 'taking') {
        // Defender is taking — they will NOT beat it. Continue the take-phase
        // throw-ins (same priority), or finalise the take if nobody else can.
        continueThrowIn(s, true);
      } else {
        s.status = 'defense'; // the defender must answer the new card
      }
      return s;
    }

    case 'DEFEND_CARD': {
      if (state.status !== 'defense') return state;
      const pairIdx = state.table.findIndex((p) => p.defense === null && sameCard(p.attack, action.attack));
      if (pairIdx === -1) return state;
      const defender = state.players[state.defenderIndex];
      if (!defender.hand.some((c) => sameCard(c, action.card))) return state;
      if (!beats(action.card, action.attack, state.trumpSuit)) return state;
      const s = clone(state);
      removeCard(s.players[s.defenderIndex].hand, action.card);
      s.table[pairIdx].defense = action.card;
      // All beaten → hand the throw to the next eligible attacker (or resolve).
      if (s.table.every((p) => p.defense !== null)) continueThrowIn(s, false);
      return s;
    }

    case 'TAKE_CARDS': {
      // Defender decides to take: DON'T collect yet — enter the 'taking' phase so
      // other attackers may still throw in (priority order). The cards are added to
      // the defender's hand only once the take-phase throw-ins end (finalizeTake).
      if (state.status !== 'defense') return state;
      const s = clone(state);
      s.passedAttackers = []; // fresh throw-in cycle; keep lastThrowerIndex (priority)
      continueThrowIn(s, true); // sets status 'taking' + a thrower, or finalises now
      return s;
    }

    case 'PASS_ATTACK': {
      // The current thrower gives up; cannot pass the opening (empty table).
      if ((state.status !== 'attack' && state.status !== 'taking') || state.table.length === 0) return state;
      const s = clone(state);
      if (!s.passedAttackers.includes(s.throwerIndex)) s.passedAttackers.push(s.throwerIndex);
      // Hand the throw on, or end the bout (defended, or the defender finally takes).
      continueThrowIn(s, state.status === 'taking');
      return s;
    }

    case 'TRANSFER_ATTACK': {
      if (!canTransfer(state)) return state;
      if (!getValidTransferCards(state).some((c) => sameCard(c, action.card))) return state;
      const s = clone(state);
      const transferrer = s.defenderIndex;
      removeCard(s.players[transferrer].hand, action.card);
      s.table.push({ attack: action.card, defense: null });
      const nd = findNextActivePlayer(s, transferrer + 1, transferrer);
      if (nd === null) return state; // no one to pass to (guarded by canTransfer)
      // The transferrer becomes the new PRIMARY attacker; the throw-in state resets.
      s.attackerIndex = transferrer;
      s.defenderIndex = nd;
      s.throwerIndex = transferrer;
      s.lastThrowerIndex = transferrer;
      s.passedAttackers = [];
      s.boutLimit = Math.min(MAX_HAND, s.players[nd].hand.length);
      s.status = 'defense';           // the new defender must respond
      return s;
    }

    case 'TRUMP_SHOW_TRANSFER': {
      // §3a one-time trump-show transfer: the card is SHOWN, not placed — it stays
      // in hand, the table is unchanged, and the option is spent for this bout.
      if (!canTrumpShowTransfer(state)) return state;
      if (!getValidTrumpShowCards(state).some((c) => sameCard(c, action.card))) return state;
      const s = clone(state);
      const transferrer = s.defenderIndex;
      // NOTE: no removeCard / no s.table.push — the shown trump remains in hand.
      const nd = findNextActivePlayer(s, transferrer + 1, transferrer);
      if (nd === null) return state; // guarded by canTrumpShowTransfer
      s.attackerIndex = transferrer; // the shower becomes the new PRIMARY attacker
      s.defenderIndex = nd;
      s.throwerIndex = transferrer;
      s.lastThrowerIndex = transferrer;
      s.passedAttackers = [];
      s.boutLimit = Math.min(MAX_HAND, s.players[nd].hand.length);
      s.status = 'defense';           // the new defender must respond
      s.trumpShowUsed = true;         // one-time per bout (survives further transfers)
      // Public, honest announcement — the card equals trumpSuit + the public attack
      // rank, so it discloses only what the rule mandates (no other hand card).
      s.lastTrumpShow = { seat: transferrer, card: action.card };
      return s;
    }

    default:
      return state;
  }
}

/** The id of the player who must act now, or null on a finished game. */
export function getActingDurakPlayerId(state: DurakState): string | null {
  if (state.status === 'finished') return null;
  // In attack AND taking phases the actor is the current thrower (an attacker);
  // only in 'defense' is it the defender.
  const idx = (state.status === 'attack' || state.status === 'taking') ? state.throwerIndex : state.defenderIndex;
  return state.players[idx]?.id ?? null;
}

export function isDurakFinished(state: DurakState): boolean {
  return state.status === 'finished';
}
