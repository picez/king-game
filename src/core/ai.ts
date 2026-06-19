import type { Card, GameModeId, GameState, ModeCounts, Suit, TrickPlay } from '../models/types';
import { getValidCards } from './rules';
import { getValidKittyDiscards } from './kitty';
import { getCurrentPlayer } from './gameEngine';

// ---------------------------------------------------------------------------
// Card classification helpers
// ---------------------------------------------------------------------------

/** Cards that carry penalties in negative modes (per-card, not per-trick). */
function isPenaltyCard(card: Card, modeId: GameModeId): boolean {
  switch (modeId) {
    case 'no_tricks':       return true;  // every trick won is a penalty
    case 'no_hearts':       return card.suit === 'hearts';
    case 'no_queens':       return card.rank === 'Q';
    case 'no_jacks':        return card.rank === 'J';
    case 'king_of_hearts':  return card.suit === 'hearts' && card.rank === 'K';
    case 'last_two_tricks': return false; // penalty is positional, not per-card
    case 'trump':           return false;
    default:                return false;
  }
}

function byValueDesc(a: Card, b: Card): number { return b.value - a.value; }
function byValueAsc(a: Card, b: Card): number { return a.value - b.value; }

/**
 * Does `card` beat the current `winning` card, given the trump suit?
 * `winning` is always either a led-suit card or a trump card.
 */
function beats(card: Card, winning: Card, trumpSuit: Suit | null): boolean {
  const cardTrump = trumpSuit != null && card.suit === trumpSuit;
  const winTrump  = trumpSuit != null && winning.suit === trumpSuit;
  if (cardTrump && !winTrump) return true;
  if (!cardTrump && winTrump) return false;
  if (card.suit === winning.suit) return card.value > winning.value;
  return false; // off-suit, non-trump — cannot beat
}

/** The card currently winning the trick so far (null if no cards played). */
function currentWinningCard(plays: TrickPlay[], trumpSuit: Suit | null): Card | null {
  if (plays.length === 0) return null;
  let best = plays[0].card;
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i].card, best, trumpSuit)) best = plays[i].card;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Negative modes: avoid taking penalties, shed penalty cards when safe
// ---------------------------------------------------------------------------

function chooseCardNegative(
  validCards: Card[],
  modeId: GameModeId,
  ledSuit: Suit | null,
  plays: TrickPlay[],
): Card {
  const penalty = (c: Card) => isPenaltyCard(c, modeId);

  // ── Leading ──────────────────────────────────────────────────────────────
  if (!ledSuit) {
    const safe = validCards.filter((c) => !penalty(c));
    // Lead a low safe card so we are unlikely to take the trick.
    const pool = safe.length > 0 ? safe : validCards;
    return [...pool].sort(byValueAsc)[0];
  }

  // ── Following (no trump in negative modes) ────────────────────────────────
  const winning = currentWinningCard(plays, null)!;
  const loses = (c: Card) => !beats(c, winning, null);

  const losing  = validCards.filter(loses);
  const winningPlays = validCards.filter((c) => !loses(c));

  if (losing.length > 0) {
    // We can avoid taking the trick. Best use of a losing card is to dump a
    // penalty card onto whoever wins; otherwise shed our highest card so we
    // keep low cards for later tricks.
    const losingPenalty = losing.filter(penalty);
    if (losingPenalty.length > 0) return [...losingPenalty].sort(byValueDesc)[0];
    return [...losing].sort(byValueDesc)[0];
  }

  // Forced to win the trick: take it as cheaply as possible and avoid adding
  // our own penalty cards to the pile when we can.
  const winNonPenalty = winningPlays.filter((c) => !penalty(c));
  const pool = winNonPenalty.length > 0 ? winNonPenalty : winningPlays;
  return [...pool].sort(byValueAsc)[0];
}

// ---------------------------------------------------------------------------
// Trick-winning play (trump mode, and early tricks of last_two_tricks)
// ---------------------------------------------------------------------------

function chooseCardWinning(
  validCards: Card[],
  trumpSuit: Suit | null,
  ledSuit: Suit | null,
  plays: TrickPlay[],
): Card {
  // ── Leading ──────────────────────────────────────────────────────────────
  if (!ledSuit) {
    const trumps = trumpSuit ? validCards.filter((c) => c.suit === trumpSuit) : [];
    if (trumps.length > 0) return [...trumps].sort(byValueDesc)[0];
    return [...validCards].sort(byValueDesc)[0];
  }

  // ── Following ──────────────────────────────────────────────────────────────
  const winning = currentWinningCard(plays, trumpSuit)!;
  const beating = validCards.filter((c) => beats(c, winning, trumpSuit));

  if (beating.length > 0) {
    // Win as cheaply as possible. Prefer winning with a non-trump so trumps
    // are saved for when they are actually needed.
    const nonTrumpBeats = trumpSuit
      ? beating.filter((c) => c.suit !== trumpSuit)
      : beating;
    const pool = nonTrumpBeats.length > 0 ? nonTrumpBeats : beating;
    return [...pool].sort(byValueAsc)[0];
  }

  // Cannot win: discard the lowest non-trump card, keeping trumps in reserve.
  const nonTrump = trumpSuit ? validCards.filter((c) => c.suit !== trumpSuit) : validCards;
  const pool = nonTrump.length > 0 ? nonTrump : validCards;
  return [...pool].sort(byValueAsc)[0];
}

// ---------------------------------------------------------------------------
// Public: choose a card to play
// ---------------------------------------------------------------------------

export function aiChooseCard(state: GameState): Card {
  const currentPlayer = getCurrentPlayer(state);
  const ledSuit = state.currentTrick?.ledSuit ?? null;
  const plays = state.currentTrick?.plays ?? [];
  const modeId = state.currentRound.mode.id;
  // Respects the "no leading hearts" rule in heart-penalty modes.
  const validCards = getValidCards(currentPlayer.hand, ledSuit, modeId);

  if (validCards.length === 0) return currentPlayer.hand[0]; // fallback (shouldn't happen)
  if (validCards.length === 1) return validCards[0];

  if (modeId === 'trump') {
    return chooseCardWinning(validCards, state.trumpSuit, ledSuit, plays);
  }

  if (modeId === 'last_two_tricks') {
    // Penalty applies only to the final two tricks. While more than two tricks
    // remain, actively WIN tricks to shed high cards — that leaves low cards
    // for the dangerous end. In the last two tricks, switch to avoidance.
    const tricksRemaining = state.config.tricksPerRound - state.currentRound.tricks.length;
    if (tricksRemaining > 2) {
      return chooseCardWinning(validCards, null, ledSuit, plays);
    }
    return chooseCardNegative(validCards, 'no_tricks', ledSuit, plays);
  }

  return chooseCardNegative(validCards, modeId, ledSuit, plays);
}

// ---------------------------------------------------------------------------
// Public: choose kitty discards (dealer must discard kittySize cards)
// ---------------------------------------------------------------------------

export function aiChooseKittyDiscards(hand: Card[], kittySize: number, modeId: GameModeId): Card[] {
  // Only legal discards are eligible — never discard the current mode's penalty
  // cards (KING_RULES.md → canDiscardToKitty).
  const legal = getValidKittyDiscards(hand, modeId);

  // Trump (positive): keep high cards to win tricks → discard the lowest legal.
  // Negative modes: shed high cards so we are less likely to win → discard the
  // highest legal cards.
  const ordered = modeId === 'trump'
    ? [...legal].sort(byValueAsc)
    : [...legal].sort(byValueDesc);

  return ordered.slice(0, kittySize);
}

// ---------------------------------------------------------------------------
// Public: choose trump suit (dealer picks trump)
// ---------------------------------------------------------------------------

export function aiChooseTrump(hand: Card[]): Suit | null {
  // Pick the longest suit, breaking ties by total high-card strength.
  const counts: Record<Suit, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  const strength: Record<Suit, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  for (const card of hand) {
    counts[card.suit]++;
    strength[card.suit] += card.value;
  }

  const best = (Object.keys(counts) as Suit[]).sort((a, b) => {
    if (counts[b] !== counts[a]) return counts[b] - counts[a];
    return strength[b] - strength[a];
  })[0];

  // Only commit to a trump if the suit is long enough to be worth it.
  return counts[best] >= 3 ? best : null;
}

// ---------------------------------------------------------------------------
// Public: choose game mode in Dealer's Choice
// ---------------------------------------------------------------------------

export function aiChooseMode(dealerModes: ModeCounts): GameModeId {
  // Choose only from THIS dealer's remaining modes (count > 0). Prefer Trump
  // while any of its (up to 3) copies remain; otherwise take the first
  // remaining negative mode in canonical order.
  if ((dealerModes.trump ?? 0) > 0) return 'trump';
  const order: GameModeId[] = [
    'no_tricks', 'no_hearts', 'no_queens', 'no_jacks', 'king_of_hearts', 'last_two_tricks',
  ];
  const pick = order.find((id) => (dealerModes[id] ?? 0) > 0);
  return pick ?? 'trump';
}
