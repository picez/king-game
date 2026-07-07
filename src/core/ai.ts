import type { Card, GameModeId, GameState, ModeCounts, Suit, TrickPlay } from '../models/types';
import { getValidCards } from './rules';
import { getValidKittyDiscards } from './kitty';
import { getCurrentPlayer, type GameAction } from './gameEngine';
import { isPerCardPenaltyCard } from './scoring';

// ---------------------------------------------------------------------------
// Card classification helpers
// ---------------------------------------------------------------------------

/**
 * Cards the AI should avoid taking in a negative mode. In No Tricks every trick
 * is a penalty, so every card counts; the four card-targeting modes defer to the
 * shared predicate; Last Two Tricks / Trump have no per-card penalty.
 */
function isPenaltyCard(card: Card, modeId: GameModeId): boolean {
  if (modeId === 'no_tricks') return true; // every trick won is a penalty
  return isPerCardPenaltyCard(card, modeId);
}

function byValueDesc(a: Card, b: Card): number { return b.value - a.value; }
function byValueAsc(a: Card, b: Card): number { return a.value - b.value; }

function suitCount(cards: Card[], suit: Suit): number {
  let n = 0;
  for (const c of cards) if (c.suit === suit) n++;
  return n;
}

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
  oppCards: Card[],
): Card {
  const penalty = (c: Card) => isPenaltyCard(c, modeId);

  // ── Leading ──────────────────────────────────────────────────────────────
  if (!ledSuit) {
    const safe = validCards.filter((c) => !penalty(c));
    const pool = safe.length > 0 ? safe : validCards;
    // Perfect-info edge (the server bot sees every hand): lead a low card that
    // some opponent can OVER-TAKE (a higher card of the same suit), so the trick
    // is taken by them, not us. Avoid leading a suit where no opponent holds a
    // higher card — that risks winning our own led trick (a penalty here).
    const overtakeable = pool.filter((c) =>
      oppCards.some((o) => o.suit === c.suit && o.value > c.value));
    const lead = overtakeable.length > 0 ? overtakeable : pool;
    // Lead low; tie-break toward our SHORTEST suit so we void it and gain room
    // to dump penalty cards later.
    return [...lead].sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      return suitCount(validCards, a.suit) - suitCount(validCards, b.suit);
    })[0];
  }

  // ── Following (no trump in negative modes) ────────────────────────────────
  const winning = currentWinningCard(plays, null)!;
  const loses = (c: Card) => !beats(c, winning, null);

  const losing  = validCards.filter(loses);
  const winningPlays = validCards.filter((c) => !loses(c));

  if (losing.length > 0) {
    // We can avoid taking the trick. Best use of a losing card is to dump a
    // penalty card onto whoever wins; otherwise shed a high card — preferring to
    // VOID a short suit (fewest cards) so we keep the flexibility to discard
    // penalties on later tricks, then breaking ties by highest value.
    const losingPenalty = losing.filter(penalty);
    if (losingPenalty.length > 0) return [...losingPenalty].sort(byValueDesc)[0];
    return [...losing].sort((a, b) => {
      const ca = suitCount(validCards, a.suit), cb = suitCount(validCards, b.suit);
      if (ca !== cb) return ca - cb;       // void the shorter suit first
      return b.value - a.value;            // then shed the higher card
    })[0];
  }

  // Forced to win the trick: add our cheapest non-penalty card, tie-breaking to
  // VOID a short suit (keeps future flexibility). Fall back to a penalty card
  // only if every winning option is one.
  const winNonPenalty = winningPlays.filter((c) => !penalty(c));
  const pool = winNonPenalty.length > 0 ? winNonPenalty : winningPlays;
  return [...pool].sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return suitCount(validCards, a.suit) - suitCount(validCards, b.suit);
  })[0];
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
    const side = trumpSuit ? validCards.filter((c) => c.suit !== trumpSuit) : validCards;
    // Cash a near-certain winner first: a side-suit Ace banks +8 without
    // spending a trump (prefer the shortest side suit so we can ruff it later).
    const sideAces = side.filter((c) => c.value === 14);
    if (sideAces.length > 0) {
      return [...sideAces].sort((a, b) => suitCount(validCards, a.suit) - suitCount(validCards, b.suit))[0];
    }
    // With trump length, lead the top trump to pull opponents' trumps.
    if (trumps.length >= 3) return [...trumps].sort(byValueDesc)[0];
    // Otherwise contest with the highest card (as the shipped bot does).
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
  // Respects the "no leading hearts" rule and the Trump forced-ruff rule.
  const validCards = getValidCards(currentPlayer.hand, ledSuit, modeId, state.trumpSuit);

  if (validCards.length === 0) return currentPlayer.hand[0]; // fallback (shouldn't happen)
  if (validCards.length === 1) return validCards[0];

  if (modeId === 'trump') {
    return chooseCardWinning(validCards, state.trumpSuit, ledSuit, plays);
  }

  // Perfect information: the server bot legally sees every hand. Collect the
  // opponents' remaining cards so negative-mode leads can avoid self-wins.
  const oppCards = state.players
    .filter((p) => p.id !== currentPlayer.id)
    .flatMap((p) => p.hand);

  if (modeId === 'last_two_tricks') {
    // Penalty applies only to the final two tricks. While more than two tricks
    // remain, actively WIN tricks to shed high cards — that leaves low cards
    // for the dangerous end. In the last two tricks, switch to avoidance.
    const tricksRemaining = state.config.tricksPerRound - state.currentRound.tricks.length;
    if (tricksRemaining > 2) {
      return chooseCardWinning(validCards, null, ledSuit, plays);
    }
    return chooseCardNegative(validCards, 'no_tricks', ledSuit, plays, oppCards);
  }

  return chooseCardNegative(validCards, modeId, ledSuit, plays, oppCards);
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

// ---------------------------------------------------------------------------
// Legacy bot (pre-improvement heuristic) — kept ONLY as an evaluation baseline
// (scripts/king-ai-eval.mjs). Production play uses the improved aiChoose* above.
// ---------------------------------------------------------------------------

function legacyChooseCardNegative(validCards: Card[], modeId: GameModeId, ledSuit: Suit | null, plays: TrickPlay[]): Card {
  const penalty = (c: Card) => isPenaltyCard(c, modeId);
  if (!ledSuit) {
    const safe = validCards.filter((c) => !penalty(c));
    const pool = safe.length > 0 ? safe : validCards;
    return [...pool].sort(byValueAsc)[0];
  }
  const winning = currentWinningCard(plays, null)!;
  const loses = (c: Card) => !beats(c, winning, null);
  const losing = validCards.filter(loses);
  const winningPlays = validCards.filter((c) => !loses(c));
  if (losing.length > 0) {
    const losingPenalty = losing.filter(penalty);
    if (losingPenalty.length > 0) return [...losingPenalty].sort(byValueDesc)[0];
    return [...losing].sort(byValueDesc)[0];
  }
  const winNonPenalty = winningPlays.filter((c) => !penalty(c));
  const pool = winNonPenalty.length > 0 ? winNonPenalty : winningPlays;
  return [...pool].sort(byValueAsc)[0];
}

function legacyChooseCardWinning(validCards: Card[], trumpSuit: Suit | null, ledSuit: Suit | null, plays: TrickPlay[]): Card {
  if (!ledSuit) {
    const trumps = trumpSuit ? validCards.filter((c) => c.suit === trumpSuit) : [];
    if (trumps.length > 0) return [...trumps].sort(byValueDesc)[0];
    return [...validCards].sort(byValueDesc)[0];
  }
  const winning = currentWinningCard(plays, trumpSuit)!;
  const beating = validCards.filter((c) => beats(c, winning, trumpSuit));
  if (beating.length > 0) {
    const nonTrumpBeats = trumpSuit ? beating.filter((c) => c.suit !== trumpSuit) : beating;
    const pool = nonTrumpBeats.length > 0 ? nonTrumpBeats : beating;
    return [...pool].sort(byValueAsc)[0];
  }
  const nonTrump = trumpSuit ? validCards.filter((c) => c.suit !== trumpSuit) : validCards;
  const pool = nonTrump.length > 0 ? nonTrump : validCards;
  return [...pool].sort(byValueAsc)[0];
}

function legacyAiChooseCard(state: GameState): Card {
  const currentPlayer = getCurrentPlayer(state);
  const ledSuit = state.currentTrick?.ledSuit ?? null;
  const plays = state.currentTrick?.plays ?? [];
  const modeId = state.currentRound.mode.id;
  const validCards = getValidCards(currentPlayer.hand, ledSuit, modeId, state.trumpSuit);
  if (validCards.length === 0) return currentPlayer.hand[0];
  if (validCards.length === 1) return validCards[0];
  if (modeId === 'trump') return legacyChooseCardWinning(validCards, state.trumpSuit, ledSuit, plays);
  if (modeId === 'last_two_tricks') {
    const tricksRemaining = state.config.tricksPerRound - state.currentRound.tricks.length;
    if (tricksRemaining > 2) return legacyChooseCardWinning(validCards, null, ledSuit, plays);
    return legacyChooseCardNegative(validCards, 'no_tricks', ledSuit, plays);
  }
  return legacyChooseCardNegative(validCards, modeId, ledSuit, plays);
}

/** The shipped-before-improvement King bot, as a full GameAction chooser. */
export function legacyKingBotAction(state: GameState): GameAction | null {
  switch (state.status) {
    case 'mode_selection': {
      const dealer = state.players[state.dealerIndex];
      return { type: 'CHOOSE_MODE', modeId: aiChooseMode(state.dealerModes[dealer.id]) };
    }
    case 'select_trump': {
      const dealer = state.players[state.dealerIndex];
      return { type: 'SELECT_TRUMP', suit: aiChooseTrump(dealer.hand) };
    }
    case 'kitty_exchange': {
      const dealer = state.players[state.dealerIndex];
      return { type: 'EXCHANGE_KITTY', discards: aiChooseKittyDiscards(dealer.hand, state.config.kittySize, state.currentRound.mode.id) };
    }
    case 'playing': {
      const p = getCurrentPlayer(state);
      return { type: 'PLAY_CARD', playerId: p.id, card: legacyAiChooseCard(state) };
    }
    default:
      return null;
  }
}
