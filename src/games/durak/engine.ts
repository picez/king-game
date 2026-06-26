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
  beats, canTransfer, findNextActivePlayer, getValidAttackCards,
  getValidTransferCards, sameCard,
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
 * After a bout resolves (draws already done), pick the next attacker starting at
 * `attackerFrom` (skipping `skip`), then the next defender, or finish the game.
 */
function rotateRoles(s: DurakState, attackerFrom: number, skip?: number): void {
  if (checkFinished(s)) return;
  const na = findNextActivePlayer(s, attackerFrom, skip);
  if (na === null) { checkFinished(s); return; }
  s.attackerIndex = na;
  const nd = findNextActivePlayer(s, na + 1, na);
  if (nd === null) { checkFinished(s); return; }
  s.defenderIndex = nd;
  s.boutLimit = Math.min(MAX_HAND, s.players[nd].hand.length);
  s.status = 'attack';
}

function startDurak(action: Extract<DurakAction, { type: 'START_DURAK' }>, ctx?: DurakContext): DurakState | null {
  const numPlayers = action.playerNames.length;
  if (numPlayers < 2 || numPlayers > 4) return null;
  const rng = ctx?.rng ?? Math.random;
  const { hands, drawPile, trumpCard, trumpSuit } = dealDurak(numPlayers, rng);
  const players: DurakPlayer[] = action.playerNames.map((name, i) => ({
    id: `player-${i}`, name, seatIndex: i, type: action.playerTypes?.[i] ?? 'human', hand: hands[i],
  }));
  const attackerIndex = findLowestTrumpHolder(hands, trumpSuit) ?? 0; // fallback seat 0
  const defenderIndex = (attackerIndex + 1) % numPlayers;
  return {
    gameType: 'durak', variant: action.variant, players, drawPile, trumpSuit, trumpCard,
    attackerIndex, defenderIndex, table: [], discardPile: [], status: 'attack',
    boutLimit: Math.min(MAX_HAND, players[defenderIndex].hand.length),
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
      if (state.status !== 'attack') return state;
      if (!getValidAttackCards(state).some((c) => sameCard(c, action.card))) return state;
      const s = clone(state);
      removeCard(s.players[s.attackerIndex].hand, action.card);
      s.table.push({ attack: action.card, defense: null });
      s.status = 'defense';
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
      if (s.table.every((p) => p.defense !== null)) s.status = 'attack'; // all beaten → attacker's move
      return s;
    }

    case 'TAKE_CARDS': {
      if (state.status !== 'defense') return state;
      const s = clone(state);
      const taken: Card[] = [];
      for (const p of s.table) { taken.push(p.attack); if (p.defense) taken.push(p.defense); }
      s.players[s.defenderIndex].hand.push(...taken);
      s.table = [];
      const oldDefender = s.defenderIndex;
      drawAfterBout(s);
      // Defender took → next attacker is the player AFTER the defender (skipped).
      rotateRoles(s, oldDefender + 1, oldDefender);
      return s;
    }

    case 'END_ATTACK': {
      if (state.status !== 'attack' || state.table.length === 0) return state;
      const s = clone(state);
      for (const p of s.table) { s.discardPile.push(p.attack); if (p.defense) s.discardPile.push(p.defense); }
      s.table = [];
      const oldDefender = s.defenderIndex;
      drawAfterBout(s);
      // Successful defense → the defender becomes the next attacker.
      rotateRoles(s, oldDefender, undefined);
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
      s.attackerIndex = transferrer;  // the transferrer joins the attack
      s.defenderIndex = nd;
      s.boutLimit = Math.min(MAX_HAND, s.players[nd].hand.length);
      s.status = 'defense';           // the new defender must respond
      return s;
    }

    default:
      return state;
  }
}

/** The id of the player who must act now, or null on a finished game. */
export function getActingDurakPlayerId(state: DurakState): string | null {
  if (state.status === 'finished') return null;
  const idx = state.status === 'attack' ? state.attackerIndex : state.defenderIndex;
  return state.players[idx]?.id ?? null;
}

export function isDurakFinished(state: DurakState): boolean {
  return state.status === 'finished';
}
