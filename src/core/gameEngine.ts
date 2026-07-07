import type {
  Card, GameConfig, GameModeId, GameState, GameStatus,
  ModeQueueEntry, Player, PlayerType, Round, Score, Suit, Trick,
} from '../models/types';
import { ALL_MODES, freshDealerModeCounts } from '../config/gameModes';
import { sanitizeAvatar } from './avatars';
import { getConfig } from '../config/gameConfigs';
import { createDeck, dealCards, shuffleDeck, validateDeck } from './deck';
import { cardEquals, isValidPlay, removeCardFromHand, resolveTrick } from './rules';
import { calculateRoundScore, isPerCardPenaltyCard } from './scoring';
import { canDiscardToKitty } from './kitty';
import { generateModeQueue } from './modeQueue';
import type { Rng } from './rng';

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'START_GAME'; playerNames: string[]; playerTypes?: PlayerType[]; playerAvatars?: (string | undefined)[]; modeSelectionType?: 'fixed' | 'dealer_choice' }
  | { type: 'PLAY_CARD'; playerId: string; card: Card }
  | { type: 'SELECT_TRUMP'; suit: Suit | null }
  | { type: 'EXCHANGE_KITTY'; discards: Card[] }
  | { type: 'CHOOSE_MODE'; modeId: GameModeId }
  | { type: 'SURRENDER_ROUND'; playerId: string }
  | { type: 'NEXT_TRICK' }
  | { type: 'NEXT_ROUND' }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Optional reducer context. `rng` makes the deal deterministic (server uses a
 * seeded RNG so rounds are reproducible/auditable). When omitted — i.e. local
 * play via `useReducer`, which only passes (state, action) — deals fall back to
 * `Math.random` exactly as before.
 */
export interface ReducerContext {
  rng?: Rng;
}

export function gameReducer(
  state: GameState | null,
  action: GameAction,
  ctx?: ReducerContext,
): GameState | null {
  switch (action.type) {
    case 'START_GAME':
      return startGame(action.playerNames, action.modeSelectionType ?? 'fixed', action.playerTypes, ctx?.rng, action.playerAvatars);
    case 'PLAY_CARD':
      return state ? handlePlayCard(state, action.playerId, action.card) : null;
    case 'SELECT_TRUMP':
      return state ? handleSelectTrump(state, action.suit) : null;
    case 'EXCHANGE_KITTY':
      return state ? handleKittyExchange(state, action.discards) : null;
    case 'CHOOSE_MODE':
      return state ? handleChooseMode(state, action.modeId) : null;
    case 'SURRENDER_ROUND':
      return state ? handleSurrender(state, action.playerId) : null;
    case 'NEXT_TRICK':
      return state ? handleNextTrick(state) : null;
    case 'NEXT_ROUND':
      return state ? handleNextRound(state, ctx?.rng) : null;
    case 'RESET':
      return null;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getCurrentPlayerIdx(state: GameState): number {
  const playsCount = state.currentTrick?.plays.length ?? 0;
  return (state.currentLeaderIdx + playsCount) % state.players.length;
}

export function getCurrentPlayer(state: GameState): Player {
  return state.players[getCurrentPlayerIdx(state)];
}

/**
 * Returns the id of the player who must act *right now*, or null if the
 * current status is a shared/public screen that no single player owns
 * (trick_complete, round_scoring, game_finished).
 *
 * This is the single source of truth for "whose private view is next",
 * used by the local pass-and-play handover and by the online server to
 * decide which client is allowed to send the next action.
 */
export function getActingPlayerId(state: GameState): string | null {
  switch (state.status) {
    case 'playing':
      return getCurrentPlayer(state).id;
    case 'mode_selection':
    case 'kitty_exchange':
    case 'select_trump':
      // The dealer is the only actor during round setup steps.
      return state.players[state.dealerIndex]?.id ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Game initialisation
// ---------------------------------------------------------------------------

function startGame(
  playerNames: string[],
  modeSelectionType: 'fixed' | 'dealer_choice' = 'fixed',
  playerTypes?: PlayerType[],
  rng: Rng = Math.random,
  playerAvatars?: (string | undefined)[],
): GameState {
  const playerCount = playerNames.length as 3 | 4;
  const config = getConfig(playerCount, modeSelectionType);

  const players: Player[] = playerNames.map((name, i) => ({
    id: `player-${i}`,
    name,
    hand: [],
    seatIndex: i,
    isDealer: false,
    type: playerTypes?.[i] ?? 'human',
    // Whitelisted avatar; fall back to a stable default per name (never blank).
    avatar: sanitizeAvatar(playerAvatars?.[i], name || `player-${i}`),
  }));

  const scores: Record<string, Score> = {};
  for (const p of players) {
    scores[p.id] = { playerId: p.id, roundScores: [], total: 0 };
  }

  // Randomly select the first dealer per PRD §7.1 (seeded on the server).
  const firstDealerIdx = Math.floor(rng() * playerCount);
  const modeQueue = generateModeQueue(playerCount, firstDealerIdx);

  // Each dealer gets their own personal set of 9 games (6 negatives + Trump ×3).
  const dealerModes: Record<string, ReturnType<typeof freshDealerModeCounts>> = {};
  for (const p of players) dealerModes[p.id] = freshDealerModeCounts();

  return startRound(
    {
      config,
      players,
      scores,
      modeQueue,
      currentRoundIdx: -1,
      currentRound: null as unknown as Round,
      currentTrick: null,
      currentLeaderIdx: 0,
      dealerIndex: 0,
      status: 'playing',
      trumpSuit: null,
      kittyForExchange: [],
      dealerModes,
      roundHistory: [],
    },
    0,
    rng,
  );
}

// ---------------------------------------------------------------------------
// Round setup
// ---------------------------------------------------------------------------

function startRound(state: GameState, roundIdx: number, rng: Rng = Math.random): GameState {
  const config: GameConfig = state.config;
  const isDealerChoice = config.modeSelectionType === 'dealer_choice';

  // In fixed mode use modeQueue entry; in dealer_choice the dealer picks later
  const entry: ModeQueueEntry = state.modeQueue[roundIdx];
  const dealerIdx = entry.dealerIdx;

  // For fixed mode, resolve the mode now; for DC use a placeholder
  const resolvedMode = isDealerChoice
    ? { ...ALL_MODES[0], id: 'no_tricks' as GameModeId, trumpSuit: null }
    : { ...ALL_MODES.find((m) => m.id === entry.modeId)!, trumpSuit: null };

  // Generate deck, validate before dealing (PRD §10.3 / §10.4 / §11.3).
  // The shuffle uses the supplied RNG (seeded on the server for reproducible
  // deals; Math.random by default for local play).
  let deck = shuffleDeck(createDeck(config.deckSize), rng);
  if (!validateDeck(deck, config.deckSize)) {
    console.error('[King] Deck validation failed — retrying deal');
    deck = shuffleDeck(createDeck(config.deckSize), rng);
  }

  const { hands, kitty } = dealCards(
    deck,
    config.playerCount,
    config.cardsPerPlayer,
    config.kittySize,
    dealerIdx,
  );

  // Mark dealer on players and assign hands
  let updatedPlayers: Player[] = state.players.map((p, i) => ({
    ...p,
    hand: hands[i],
    isDealer: i === dealerIdx,
  }));

  // For DC mode: deal first, then dealer picks mode (no kitty expansion yet)
  if (isDealerChoice) {
    const collectedCards: Record<string, Card[]> = {};
    for (const p of state.players) collectedCards[p.id] = [];

    const round: Round = {
      roundNumber: roundIdx,
      mode: resolvedMode,
      dealerId: updatedPlayers[dealerIdx].id,
      kitty,
      discard: [],
      tricks: [],
      collectedCards,
      scores: {},
      status: 'playing',
    };

    // The dealer chooses from their own remaining modes (state.dealerModes),
    // which carries over via the spread below — no global mode pool.
    return {
      ...state,
      players: updatedPlayers,
      currentRoundIdx: roundIdx,
      currentRound: round,
      currentTrick: null,
      currentLeaderIdx: dealerIdx, // the dealer leads the first trick (KING_RULES.md)
      dealerIndex: dealerIdx,
      status: 'mode_selection',
      trumpSuit: null,
      kittyForExchange: [],
    };
  }

  // Fixed mode flow (mode is already known from the queue).
  const mode = resolvedMode;
  const isTrump = mode.id === 'trump';
  const hasKitty = config.kittySize > 0; // 3-player games

  let roundKitty: Card[] = kitty;
  let kittyForExchange: Card[] = [];
  let status: GameStatus;

  // Trump chooses the suit BEFORE the kitty: keep the kitty pending (in
  // round.kitty) and the dealer's hand untouched until trump is selected. Every
  // other mode takes the kitty now (when one exists) and discards first.
  if (isTrump) {
    status = 'select_trump';
  } else if (hasKitty) {
    kittyForExchange = kitty;
    updatedPlayers = takeKitty(updatedPlayers, dealerIdx, kitty);
    roundKitty = [];
    status = 'kitty_exchange';
  } else {
    status = 'playing';
  }

  const collectedCards: Record<string, Card[]> = {};
  for (const p of state.players) collectedCards[p.id] = [];

  const round: Round = {
    roundNumber: roundIdx,
    mode,
    dealerId: updatedPlayers[dealerIdx].id,
    kitty: roundKitty,
    discard: [],
    tricks: [],
    collectedCards,
    scores: {},
    status: 'playing',
  };

  const leaderIdx = dealerIdx; // the dealer leads the first trick (KING_RULES.md)

  // Consume this mode from the dealer's personal set (mirrors Dealer's Choice).
  const fixedDealerModes = consumeDealerMode(
    state.dealerModes,
    updatedPlayers[dealerIdx].id,
    mode.id,
  );

  return {
    ...state,
    players: updatedPlayers,
    currentRoundIdx: roundIdx,
    currentRound: round,
    currentTrick: null,
    currentLeaderIdx: leaderIdx,
    dealerIndex: dealerIdx,
    status,
    trumpSuit: null,
    kittyForExchange,
    dealerModes: fixedDealerModes,
  };
}

/** Moves the round's kitty cards into the dealer's hand (the kitty_exchange step). */
function takeKitty(players: Player[], dealerIdx: number, kitty: Card[]): Player[] {
  const dealerId = players[dealerIdx].id;
  return players.map((p) => (p.id === dealerId ? { ...p, hand: [...p.hand, ...kitty] } : p));
}

/**
 * Returns a new dealerModes map with one mode decremented for one dealer
 * (never below 0). One dealer's choice never affects another dealer's set.
 */
function consumeDealerMode(
  dealerModes: GameState['dealerModes'],
  dealerId: string,
  modeId: GameModeId,
): GameState['dealerModes'] {
  const current = dealerModes[dealerId];
  if (!current) return dealerModes;
  return {
    ...dealerModes,
    [dealerId]: { ...current, [modeId]: Math.max(0, current[modeId] - 1) },
  };
}

/**
 * Early-end check: true when every penalty card of the mode has already been
 * collected, so the remaining tricks can't change the score. Only applies to
 * card-targeting negative modes; No Tricks / Last Two Tricks / Trump never end
 * early. Penalty cards can't be discarded (see kitty rules) so "all collected"
 * means "all in someone's pile".
 */
export function allPenaltiesCollected(
  modeId: GameModeId,
  collectedCards: Record<string, Card[]>,
  deckSize: number,
): boolean {
  // How many penalty cards must be collected before the mode's score is locked.
  // Undefined ⇒ a positional/per-trick mode that never ends early.
  const required: Partial<Record<GameModeId, number>> = {
    no_hearts: deckSize / 4, // hearts in the deck (8 for 32, 13 for 52)
    no_queens: 4,
    no_jacks: 4,
    king_of_hearts: 1,
  };
  const threshold = required[modeId];
  if (threshold === undefined) return false; // no_tricks, last_two_tricks, trump

  const collected = Object.values(collectedCards)
    .flat()
    .filter((c) => isPerCardPenaltyCard(c, modeId)).length;
  return collected >= threshold;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handlePlayCard(
  state: GameState,
  playerId: string,
  card: Card,
): GameState {
  if (state.status !== 'playing') return state;

  const currentPlayer = getCurrentPlayer(state);
  if (currentPlayer.id !== playerId) return state;

  const ledSuit = state.currentTrick?.ledSuit ?? null;
  // Pass the trump suit so Trump mode can enforce the forced-ruff rule.
  if (!isValidPlay(card, currentPlayer.hand, ledSuit, state.currentRound.mode.id, state.trumpSuit)) return state;

  const newPlayers = state.players.map((p) =>
    p.id === playerId ? { ...p, hand: removeCardFromHand(p.hand, card) } : p,
  );
  const updatedTrick = appendPlayToTrick(state, playerId, card);

  // Trick still in progress — wait for the remaining players.
  if (updatedTrick.plays.length < state.players.length) {
    return { ...state, players: newPlayers, currentTrick: updatedTrick };
  }

  // Trick complete — resolve the winner and hand them the collected cards.
  const winnerId = resolveTrick(updatedTrick, state.trumpSuit);
  const resolvedTrick: Trick = { ...updatedTrick, winnerId };
  const newCollected = collectTrickCards(state.currentRound.collectedCards, winnerId, resolvedTrick);
  const newTricks = [...state.currentRound.tricks, resolvedTrick];
  const winnerIdx = state.players.findIndex((p) => p.id === winnerId);

  // Round ends when all tricks are played OR all penalty cards of the mode are
  // already collected (early end — no point playing out meaningless tricks).
  const roundDone =
    newTricks.length >= state.config.tricksPerRound ||
    allPenaltiesCollected(state.currentRound.mode.id, newCollected, state.config.deckSize);

  return roundDone
    ? scoreCompletedRound(state, newPlayers, resolvedTrick, newTricks, newCollected, winnerIdx)
    : advanceAfterTrick(state, newPlayers, resolvedTrick, newTricks, newCollected, winnerIdx);
}

/** Appends the played card to the running trick, or opens a fresh trick if none. */
function appendPlayToTrick(state: GameState, playerId: string, card: Card): Trick {
  if (state.currentTrick) {
    return {
      ...state.currentTrick,
      plays: [
        ...state.currentTrick.plays,
        { playerId, card, playOrder: state.currentTrick.plays.length + 1 },
      ],
    };
  }
  return {
    trickNumber: state.currentRound.tricks.length + 1,
    leadPlayerId: playerId,
    ledSuit: card.suit,
    plays: [{ playerId, card, playOrder: 1 }],
    winnerId: null,
  };
}

/** Adds a resolved trick's cards to the winner's collected pile (immutably). */
function collectTrickCards(
  collectedCards: Record<string, Card[]>,
  winnerId: string,
  resolvedTrick: Trick,
): Record<string, Card[]> {
  return {
    ...collectedCards,
    [winnerId]: [...collectedCards[winnerId], ...resolvedTrick.plays.map((p) => p.card)],
  };
}

/** Trick resolved but the round continues — pause on trick_complete with the winner leading. */
function advanceAfterTrick(
  state: GameState,
  newPlayers: GameState['players'],
  resolvedTrick: Trick,
  newTricks: Trick[],
  newCollected: Record<string, Card[]>,
  winnerIdx: number,
): GameState {
  return {
    ...state,
    players: newPlayers,
    currentRound: {
      ...state.currentRound,
      tricks: newTricks,
      collectedCards: newCollected,
    },
    currentTrick: resolvedTrick,
    currentLeaderIdx: winnerIdx,
    status: 'trick_complete',
  };
}

/** Final trick of the round — tally scores, close the round, append history. */
function scoreCompletedRound(
  state: GameState,
  newPlayers: GameState['players'],
  resolvedTrick: Trick,
  newTricks: Trick[],
  newCollected: Record<string, Card[]>,
  winnerIdx: number,
): GameState {
  const playerIds = state.players.map((p) => p.id);
  const roundScores = calculateRoundScore(
    state.currentRound.mode.id,
    newTricks,
    newCollected,
    playerIds,
    state.config.scoring,
  );

  // No kitty penalty: discarded cards left the game and are scored to nobody.
  const newScores = { ...state.scores };
  for (const pid of playerIds) {
    const roundScore = roundScores[pid] ?? 0;
    newScores[pid] = {
      ...newScores[pid],
      roundScores: [...newScores[pid].roundScores, roundScore],
      total: newScores[pid].total + roundScore,
    };
  }

  const completedRound: Round = {
    ...state.currentRound,
    tricks: newTricks,
    collectedCards: newCollected,
    scores: roundScores,
    status: 'complete',
  };

  // Append a scores-only record to the round history (powers the score tracker).
  // Records every completed round identically, including early-ended ones.
  const roundHistory = appendRoundHistory(state, completedRound, roundScores);

  return {
    ...state,
    players: newPlayers,
    scores: newScores,
    currentRound: completedRound,
    currentTrick: resolvedTrick,
    currentLeaderIdx: winnerIdx,
    status: 'round_scoring',
    roundHistory,
  };
}

/**
 * Builds the next round-history array with one record for the just-completed
 * round. Trump games are numbered per dealer in play order (1st, 2nd, 3rd).
 */
function appendRoundHistory(
  state: GameState,
  completedRound: Round,
  roundScores: Record<string, number>,
): GameState['roundHistory'] {
  const history = state.roundHistory ?? [];
  const dealerId = completedRound.dealerId;
  const modeId = completedRound.mode.id;
  const priorTrump = history.filter((r) => r.dealerId === dealerId && r.modeId === 'trump').length;
  const scoreByPlayer: Record<string, number> = {};
  for (const p of state.players) scoreByPlayer[p.id] = roundScores[p.id] ?? 0;
  return [
    ...history,
    {
      roundNumber: state.currentRoundIdx,
      dealerId,
      modeId,
      trumpOccurrence: modeId === 'trump' ? priorTrump + 1 : 0,
      scoreByPlayer,
    },
  ];
}

/**
 * Surrender (concede the round). MVP rule (KING_RULES.md → Surrender): only the
 * current actor may concede, and only in a NEGATIVE mode (disabled in Trump).
 * The round ends now; every penalty still in play is charged to the surrendering
 * player, then the round is scored normally:
 *  - per-card modes (No Hearts/Queens/Jacks, King of Hearts): all uncollected
 *    penalty cards (in hands + the current trick) go to the surrendering player;
 *  - per-trick modes (No Tricks, Last Two Tricks): every remaining trick is
 *    awarded to the surrendering player.
 * This can never be an advantageous exploit — you take all the outstanding
 * penalties yourself.
 */
function handleSurrender(state: GameState, playerId: string): GameState {
  if (state.status !== 'playing') return state;
  if (getCurrentPlayer(state).id !== playerId) return state;       // self, on turn only
  const modeId = state.currentRound.mode.id;
  if (modeId === 'trump') return state;                            // disabled in Trump (MVP)

  const playerIds = state.players.map((p) => p.id);
  const collectedFinal: Record<string, Card[]> = {};
  for (const pid of playerIds) collectedFinal[pid] = [...state.currentRound.collectedCards[pid]];
  let tricksFinal = state.currentRound.tricks;

  if (modeId === 'no_tricks' || modeId === 'last_two_tricks') {
    // Award every remaining trick to the surrendering player.
    const remaining = state.config.tricksPerRound - state.currentRound.tricks.length;
    const synthetic: Trick[] = Array.from({ length: Math.max(0, remaining) }, (_, i) => ({
      trickNumber: state.currentRound.tricks.length + i + 1,
      leadPlayerId: playerId,
      ledSuit: 'spades' as Suit,
      plays: [],
      winnerId: playerId,
    }));
    tricksFinal = [...state.currentRound.tricks, ...synthetic];
  } else {
    // Per-card mode: all uncollected penalty cards (hands + current trick) go to
    // the surrendering player.
    const inPlay: Card[] = [
      ...state.players.flatMap((p) => p.hand),
      ...(state.currentTrick?.plays.map((pl) => pl.card) ?? []),
    ];
    const remainingPenalties = inPlay.filter((c) => isPerCardPenaltyCard(c, modeId));
    collectedFinal[playerId] = [...collectedFinal[playerId], ...remainingPenalties];
  }

  const roundScores = calculateRoundScore(
    modeId, tricksFinal, collectedFinal, playerIds, state.config.scoring,
  );

  const newScores = { ...state.scores };
  for (const pid of playerIds) {
    const rs = roundScores[pid] ?? 0;
    newScores[pid] = {
      ...newScores[pid],
      roundScores: [...newScores[pid].roundScores, rs],
      total: newScores[pid].total + rs,
    };
  }

  const completedRound: Round = {
    ...state.currentRound,
    tricks: tricksFinal,
    collectedCards: collectedFinal,
    scores: roundScores,
    status: 'complete',
    surrenderedBy: playerId,
  };
  const roundHistory = appendRoundHistory(state, completedRound, roundScores);

  return {
    ...state,
    scores: newScores,
    currentRound: completedRound,
    currentTrick: null,
    status: 'round_scoring',
    roundHistory,
  };
}

function handleSelectTrump(state: GameState, suit: Suit | null): GameState {
  if (state.status !== 'select_trump') return state;
  // Trump is chosen BEFORE the kitty. Now that the suit is set, the dealer takes
  // the still-pending kitty (if any) and moves on to discard; with no kitty
  // (4-player) play starts immediately.
  const updatedMode = { ...state.currentRound.mode, trumpSuit: suit };
  const pendingKitty = state.currentRound.kitty; // untaken during trump flow
  if (pendingKitty.length > 0) {
    const players = takeKitty(state.players, state.dealerIndex, pendingKitty);
    return {
      ...state,
      players,
      trumpSuit: suit,
      currentRound: { ...state.currentRound, mode: updatedMode, kitty: [] },
      kittyForExchange: pendingKitty,
      status: 'kitty_exchange',
    };
  }
  return {
    ...state,
    trumpSuit: suit,
    currentRound: { ...state.currentRound, mode: updatedMode },
    status: 'playing',
  };
}

function handleChooseMode(state: GameState, modeId: GameModeId): GameState {
  if (state.status !== 'mode_selection') return state;

  const config = state.config;
  const dealerIdx = state.dealerIndex;
  const dealerId = state.players[dealerIdx].id;

  // The dealer may only choose from their OWN remaining modes. Reject anything
  // they have already used up (authoritative — server-side online).
  if ((state.dealerModes[dealerId]?.[modeId] ?? 0) <= 0) return state;

  const baseMode = ALL_MODES.find((m) => m.id === modeId)!;
  const mode = { ...baseMode, trumpSuit: null };

  const isTrump = modeId === 'trump';
  // Whenever a kitty exists (3-player games) the dealer takes it and discards
  // (non-Trump modes). 4-player games have no kitty.
  const hasKitty = config.kittySize > 0;

  // Decrement only THIS dealer's count for the chosen mode.
  const dealerModes = consumeDealerMode(state.dealerModes, dealerId, modeId);

  // Trump: the dealer chooses the suit BEFORE taking the kitty. Leave the hand
  // and the (pending) kitty untouched and go to trump selection. The kitty is
  // taken later, in handleSelectTrump — so it never becomes visible first.
  if (isTrump) {
    return {
      ...state,
      currentRound: { ...state.currentRound, mode },
      dealerModes,
      kittyForExchange: [],
      trumpSuit: null,
      status: 'select_trump',
    };
  }

  // Non-Trump: take the kitty now (if any) and discard; otherwise start playing.
  let updatedPlayers = state.players;
  let kittyForExchange: Card[] = [];
  let roundKitty = state.currentRound.kitty;
  if (hasKitty) {
    kittyForExchange = state.currentRound.kitty;
    updatedPlayers = takeKitty(state.players, dealerIdx, state.currentRound.kitty);
    roundKitty = [];
  }

  return {
    ...state,
    players: updatedPlayers,
    currentRound: { ...state.currentRound, mode, kitty: roundKitty },
    dealerModes,
    kittyForExchange,
    trumpSuit: null,
    status: hasKitty ? 'kitty_exchange' : 'playing',
  };
}

function handleKittyExchange(state: GameState, discards: Card[]): GameState {
  if (state.status !== 'kitty_exchange') return state;
  if (discards.length !== state.config.kittySize) return state;

  const dealer = state.players[state.dealerIndex];
  const modeId = state.currentRound.mode.id;

  // Reject illegal discards even if the UI failed to block them. This is the
  // authoritative check (server-side online): no duplicates, all in hand, and
  // none are penalty cards of the current mode.
  const seen = new Set<string>();
  for (const d of discards) {
    const key = `${d.suit}:${d.rank}`;
    if (seen.has(key)) return state;
    seen.add(key);
    if (!dealer.hand.some((c) => cardEquals(c, d))) return state;
    if (!canDiscardToKitty(d, modeId)) return state;
  }

  // Remove discards from dealer's hand. Discarded cards leave the game — they
  // are never recorded in the kitty or collectedCards and are scored to nobody.
  let newHand = [...dealer.hand];
  for (const d of discards) {
    newHand = removeCardFromHand(newHand, d);
  }

  const updatedPlayers = state.players.map((p) =>
    p.id === dealer.id ? { ...p, hand: newHand } : p,
  );

  return {
    ...state,
    players: updatedPlayers,
    // Keep the discard privately on the round so the dealer can review it.
    currentRound: { ...state.currentRound, discard: discards },
    kittyForExchange: [],
    // Trump's suit was already chosen before the kitty, so every mode now starts
    // playing right after the discard.
    status: 'playing',
  };
}

function handleNextTrick(state: GameState): GameState {
  if (state.status !== 'trick_complete') return state;
  return { ...state, currentTrick: null, status: 'playing' };
}

function handleNextRound(state: GameState, rng: Rng = Math.random): GameState {
  if (state.status !== 'round_scoring') return state;
  const nextIdx = state.currentRoundIdx + 1;
  if (nextIdx >= state.modeQueue.length) {
    return { ...state, status: 'game_finished' };
  }
  return startRound(state, nextIdx, rng);
}
