// ---------------------------------------------------------------------------
// Deberc — pure reducer (Stage 2). Deterministic (shuffle via injected rng),
// no browser/server APIs. Illegal actions return the SAME state reference.
// Mirrors King/Durak's reducer contract with Deberc's own state/action.
// See DEBERC_RULES.md for every rule encoded here.
//
// Meld handling is AUTO-DETECT in v1 (proposed design, see the deberc-game
// memory): терц/платіна/деберц are scored automatically from the dealt hands,
// and the bella is credited when its holder wins a trick with a trump K or Q.
// DECLARE_MELD is reserved for a later explicit-declaration mode → it is a no-op.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import type { DebercAction, DebercContext, DebercMeld, DebercPlayer, DebercState } from './types';
import { dealDeberc, seqValue } from './deck';
import { cardEquals, isLegalPlay, legalPlays, resolveTrick } from './rules';
import { detectBestSequence, hasBella, scoringSequenceSeats } from './melds';
import { BELLA_POINTS, scoreHand } from './scoring';

const HAND_TRICKS = 9;
const DEBERC_LENGTH = 8; // an 8- or 9-card run = деберц jackpot
const PAIR_PENALTY = 100;
const TARGET: Record<'small' | 'big', number> = { small: 510, big: 1020 };

function clone(state: DebercState): DebercState {
  return JSON.parse(JSON.stringify(state)) as DebercState; // pure JSON data → safe deep copy
}

function removeCard(hand: Card[], card: Card): void {
  const i = hand.findIndex((c) => cardEquals(c, card));
  if (i >= 0) hand.splice(i, 1);
}

/** Index of the max value; ties broken toward the lowest index (deterministic). */
function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Seats belonging to a team. */
function seatsOfTeam(s: DebercState, team: number): number[] {
  const seats: number[] = [];
  s.teamOf.forEach((t, seat) => { if (t === team) seats.push(seat); });
  return seats;
}

/**
 * The seat that represents a team as the next об'яз: the partner who won the most
 * card points (ties → lowest seat). Trivially the team itself in a 3-player game.
 */
function repSeatOfTeam(s: DebercState, team: number): number {
  const seats = seatsOfTeam(s, team);
  let best = seats[0];
  let bestPts = s.wonCards[best].length;
  for (const seat of seats) {
    if (s.wonCards[seat].length > bestPts) { best = seat; bestPts = s.wonCards[seat].length; }
  }
  return best;
}

// --- Ledger (ХВ / бейт penalty accounting, DEBERC_RULES.md §7) --------------

/**
 * Apply one ХВ/бейт mark to a team's ledger given its current outstanding marks.
 * The first mark of a kind is only recorded; completing a same-kind PAIR costs
 * −100; a mixed ХВ+бейт pair cancels (both clear, no penalty). At most one of
 * `hvMark`/`beitMark` is ever outstanding (>0), because a mix cancels on arrival.
 */
export function applyMark(
  kind: 'hv' | 'beit',
  hvMark: number,
  beitMark: number,
): { hv: number; beit: number; penalty: number } {
  if (kind === 'hv') {
    if (beitMark > 0) return { hv: 0, beit: 0, penalty: 0 };        // mixed pair cancels
    if (hvMark > 0) return { hv: 0, beit: beitMark, penalty: PAIR_PENALTY }; // ХВ pair
    return { hv: 1, beit: beitMark, penalty: 0 };                   // first ХВ — recorded
  }
  if (hvMark > 0) return { hv: 0, beit: 0, penalty: 0 };            // mixed pair cancels
  if (beitMark > 0) return { hv: hvMark, beit: 0, penalty: PAIR_PENALTY }; // бейт pair
  return { hv: hvMark, beit: 1, penalty: 0 };                       // first бейт — recorded
}

function addMark(s: DebercState, kind: 'hv' | 'beit', team: number): void {
  const r = applyMark(kind, s.hvMarks[team], s.beitMarks[team]);
  s.hvMarks[team] = r.hv;
  s.beitMarks[team] = r.beit;
  s.matchScore[team] -= r.penalty;
}

// --- Deal + hand setup ------------------------------------------------------

/** True (and finishes `s` as a jackpot) if any seat holds a деберц (8–9 run). */
function checkDebercJackpot(s: DebercState): boolean {
  for (let seat = 0; seat < s.players.length; seat++) {
    const best = detectBestSequence(s.players[seat].hand, seat, null);
    if (best && best.cards.length >= DEBERC_LENGTH) {
      s.phase = 'finished';
      s.winnerTeam = s.teamOf[seat];
      s.jackpot = true;
      return true;
    }
  }
  return false;
}

/** Deal a fresh hand with `dealerSeat` as the initial об'яз, and open bidding. */
function dealNextHand(s: DebercState, dealerSeat: number, ctx?: DebercContext): void {
  const n = s.players.length;
  const rng = ctx?.rng ?? Math.random;
  const { hands, tableTrumpCard, stock } = dealDeberc(n, dealerSeat, rng);
  s.players.forEach((p, i) => { p.hand = hands[i]; });
  s.dealerSeat = dealerSeat;
  s.objazSeat = dealerSeat;
  s.tableTrumpCard = tableTrumpCard;
  s.stock = stock;
  s.trumpSuit = null;
  s.phase = 'bidding';
  s.bidderSeat = (dealerSeat + 1) % n;
  s.bids = [];
  s.bidRound = 1;
  s.currentTrick = null;
  s.turnSeat = dealerSeat;
  s.wonCards = Array.from({ length: n }, () => []);
  s.tricksPlayed = 0;
  s.seatsWithTricks = [];
  s.melds = [];
  s.dealtHands = [];
  s.bellaEligible = [];
  s.bellaEarned = [];
  checkDebercJackpot(s);
}

/** Commit `trump` chosen by `seat` (it intercepts the об'яз role) and start play. */
function commitTrump(s: DebercState, seat: number, trump: Suit): void {
  s.trumpSuit = trump;
  s.objazSeat = seat;
  s.dealtHands = s.players.map((p) => p.hand.map((c) => ({ ...c })));
  s.bellaEligible = [];
  for (let i = 0; i < s.players.length; i++) {
    if (hasBella(s.players[i].hand, trump)) s.bellaEligible.push(i);
  }
  s.bellaEarned = [];
  s.wonCards = Array.from({ length: s.players.length }, () => []);
  s.seatsWithTricks = [];
  s.tricksPlayed = 0;
  s.currentTrick = null;
  s.turnSeat = s.objazSeat; // the об'яз leads the first trick
  s.phase = 'playing';
}

function startDeberc(
  action: Extract<DebercAction, { type: 'START_DEBERC' }>,
  ctx?: DebercContext,
): DebercState | null {
  const n = action.playerNames.length;
  if (n !== 3 && n !== 4) return null; // 3 = each for self, 4 = two teams of 2
  const rng = ctx?.rng ?? Math.random;
  const dealerSeat = Math.floor(rng() * n) % n; // §3 first-hand об'яз ≈ random seat
  const { hands, tableTrumpCard, stock } = dealDeberc(n, dealerSeat, rng);
  const teamOf = n === 4 ? [0, 1, 0, 1] : [0, 1, 2];
  const teamCount = n === 4 ? 2 : 3;
  const players: DebercPlayer[] = action.playerNames.map((name, i) => ({
    id: `player-${i}`, name, seatIndex: i, type: action.playerTypes?.[i] ?? 'human', hand: hands[i],
  }));
  const s: DebercState = {
    gameType: 'deberc', matchSize: action.matchSize, players, teamOf, teamCount,
    phase: 'bidding', tableTrumpCard, stock, trumpSuit: null,
    objazSeat: dealerSeat, dealerSeat, bidderSeat: (dealerSeat + 1) % n, bids: [], bidRound: 1,
    currentTrick: null, turnSeat: dealerSeat,
    wonCards: Array.from({ length: n }, () => []), tricksPlayed: 0, seatsWithTricks: [], melds: [],
    dealtHands: [], bellaEligible: [], bellaEarned: [],
    matchScore: Array<number>(teamCount).fill(0),
    hvMarks: Array<number>(teamCount).fill(0),
    beitMarks: Array<number>(teamCount).fill(0),
    lastHand: null, winnerTeam: null, jackpot: false,
  };
  checkDebercJackpot(s);
  return s;
}

// --- Play + trick resolution ------------------------------------------------

/** Finalize a completed trick: winner, won cards, бейт tracking, bella credit. */
function finalizeTrick(s: DebercState): void {
  const trick = s.currentTrick!;
  const winner = resolveTrick(trick.plays, trick.ledSuit, s.trumpSuit);
  trick.winnerSeat = winner;
  for (const p of trick.plays) s.wonCards[winner].push(p.card);
  s.tricksPlayed += 1;
  if (!s.seatsWithTricks.includes(winner)) s.seatsWithTricks.push(winner);
  // Bella: earned if an eligible holder wins a trick playing their trump K or Q.
  if (s.bellaEligible.includes(winner) && !s.bellaEarned.includes(winner)) {
    const played = trick.plays.find((p) => p.seatIndex === winner)!.card;
    if (played.suit === s.trumpSuit && (played.rank === 'K' || played.rank === 'Q')) {
      s.bellaEarned.push(winner);
    }
  }
  s.turnSeat = winner; // the winner leads next
  s.phase = 'trick_complete';
}

/** The sequence + bella melds that actually score this hand (for display). */
function collectScoringMelds(s: DebercState): DebercMeld[] {
  const best = s.dealtHands.map((h, seat) => detectBestSequence(h, seat, s.trumpSuit));
  const melds: DebercMeld[] = [];
  for (const seat of scoringSequenceSeats(best)) {
    const m = best[seat];
    if (m) melds.push(m);
  }
  for (const seat of s.bellaEarned) {
    const k = s.dealtHands[seat].find((c) => c.suit === s.trumpSuit && c.rank === 'K');
    const q = s.dealtHands[seat].find((c) => c.suit === s.trumpSuit && c.rank === 'Q');
    if (k && q) {
      melds.push({ seatIndex: seat, kind: 'bella', points: BELLA_POINTS, cards: [k, q], topValue: seqValue('K'), isTrump: true });
    }
  }
  return melds;
}

/** Score the finished hand into per-team match points, ХВ/бейт, and the ledger. */
function scoreAndAdvance(s: DebercState, ctx?: DebercContext): void {
  const trump = s.trumpSuit!;
  const best = s.dealtHands.map((h, seat) => detectBestSequence(h, seat, trump));
  const lastTrickWinnerSeat = s.currentTrick?.winnerSeat ?? s.objazSeat;
  const score = scoreHand({
    wonCards: s.wonCards, trumpSuit: trump, lastTrickWinnerSeat,
    teamOf: s.teamOf, teamCount: s.teamCount, bestSequences: best, bellaSeats: s.bellaEarned,
  });
  const teamPoints = score.teamPoints.slice();

  // ХВ: the об'яз scored fewer points than at least one other team (§7).
  const objazTeam = s.teamOf[s.objazSeat];
  let otherMax = -Infinity;
  for (let t = 0; t < s.teamCount; t++) if (t !== objazTeam) otherMax = Math.max(otherMax, teamPoints[t]);
  const hvOccurs = teamPoints[objazTeam] < otherMax;
  const topScorerTeam = argmax(teamPoints); // об'яз is not the max when hvOccurs
  let hvTeam: number | null = null;
  if (hvOccurs) {
    teamPoints[topScorerTeam] += teamPoints[objazTeam]; // об'яз's points go to the top scorer
    teamPoints[objazTeam] = 0;
    addMark(s, 'hv', objazTeam);
    hvTeam = objazTeam;
  }

  // Бейт: any team that took zero tricks. ХВ is applied first so an об'яз that
  // earns both in one hand cancels them as a mixed pair.
  const beitTeams: number[] = [];
  for (let t = 0; t < s.teamCount; t++) {
    const wonAny = s.wonCards.some((cards, seat) => s.teamOf[seat] === t && cards.length > 0);
    if (!wonAny) { addMark(s, 'beit', t); beitTeams.push(t); }
  }

  for (let t = 0; t < s.teamCount; t++) s.matchScore[t] += teamPoints[t];
  s.lastHand = {
    teamPoints, cardPoints: score.cardPoints, meldPoints: score.meldPoints,
    hvTeam, beitTeams, topScorerTeam,
  };

  const target = TARGET[s.matchSize];
  if (s.matchScore.some((v) => v >= target)) {
    s.phase = 'finished';
    s.winnerTeam = argmax(s.matchScore);
    s.jackpot = false;
    return;
  }
  // §3: the winner of the hand becomes the next об'яз (also the ХВ top scorer).
  dealNextHand(s, repSeatOfTeam(s, topScorerTeam), ctx);
}

// --- Reducer ----------------------------------------------------------------

export function debercReducer(
  state: DebercState | null,
  action: DebercAction,
  ctx?: DebercContext,
): DebercState | null {
  if (action.type === 'START_DEBERC') {
    if (state !== null) return state; // already started → illegal
    return startDeberc(action, ctx);
  }
  if (state === null) return null;
  if (state.phase === 'finished') return state;

  switch (action.type) {
    case 'BID': {
      if (state.phase !== 'bidding') return state;
      const n = state.players.length;
      const s = clone(state);
      const seat = s.bidderSeat;
      if (action.suit != null) {
        // Round 1 accepts the face-up table trump; round 2 declares a free suit.
        const trump = s.bidRound === 1 ? s.tableTrumpCard.suit : action.suit;
        s.bids.push({ seatIndex: seat, suit: trump, round: s.bidRound });
        commitTrump(s, seat, trump);
        return s;
      }
      // Pass.
      s.bids.push({ seatIndex: seat, suit: null, round: s.bidRound });
      const passes = s.bids.filter((b) => b.round === s.bidRound && b.suit === null).length;
      if (passes >= n) {
        if (s.bidRound === 1) {
          s.bidRound = 2;
          s.bidderSeat = (s.dealerSeat + 1) % n;
        } else {
          // Everyone passed both rounds (§8.1): force the table trump onto the об'яз.
          commitTrump(s, s.dealerSeat, s.tableTrumpCard.suit);
        }
      } else {
        s.bidderSeat = (s.bidderSeat + 1) % n;
      }
      return s;
    }

    case 'PLAY_CARD': {
      if (state.phase !== 'playing') return state;
      const n = state.players.length;
      const seat = state.turnSeat;
      const hand = state.players[seat].hand;
      const ledSuit = state.currentTrick ? state.currentTrick.ledSuit : null;
      if (!isLegalPlay(action.card, hand, ledSuit, state.trumpSuit)) return state;
      const s = clone(state);
      removeCard(s.players[seat].hand, action.card);
      if (s.currentTrick == null) {
        s.currentTrick = {
          leadSeat: seat, ledSuit: action.card.suit,
          plays: [{ seatIndex: seat, card: action.card, playOrder: 1 }], winnerSeat: null,
        };
      } else {
        s.currentTrick.plays.push({
          seatIndex: seat, card: action.card, playOrder: s.currentTrick.plays.length + 1,
        });
      }
      if (s.currentTrick.plays.length < n) {
        s.turnSeat = (seat + 1) % n;
      } else {
        finalizeTrick(s);
      }
      return s;
    }

    case 'NEXT_TRICK': {
      if (state.phase !== 'trick_complete') return state;
      const s = clone(state);
      if (s.tricksPlayed >= HAND_TRICKS) {
        s.melds = collectScoringMelds(s);
        s.phase = 'hand_scoring';
      } else {
        s.currentTrick = null;
        s.phase = 'playing'; // turnSeat already = the trick winner (next leader)
      }
      return s;
    }

    case 'NEXT_HAND': {
      if (state.phase !== 'hand_scoring') return state;
      const s = clone(state);
      scoreAndAdvance(s, ctx);
      return s;
    }

    // DECLARE_MELD is a no-op in the v1 auto-detect model (see the file header).
    default:
      return state;
  }
}

/**
 * The id of the player who must act now, or null when no single player acts.
 *
 * `trick_complete` and `hand_scoring` are SYSTEM-advanced public screens (like
 * King's trick_complete/round_scoring): they return null so the online server
 * treats them as auto-advance screens rather than a player's turn. This is what
 * lets the server drive NEXT_TRICK / NEXT_HAND itself — critically, NEXT_HAND
 * re-deals and must be threaded with a server seed (see serverCore.autoAdvance),
 * so it must never be a client-driven action. Local play auto-advances these
 * screens on a timer the same way.
 */
export function getActingDebercPlayerId(state: DebercState): string | null {
  switch (state.phase) {
    case 'bidding': return state.players[state.bidderSeat]?.id ?? null;
    case 'playing': return state.players[state.turnSeat]?.id ?? null;
    default: return null; // trick_complete / hand_scoring / finished → no actor
  }
}

export function isDebercFinished(state: DebercState): boolean {
  return state.phase === 'finished';
}

/** Cards the acting seat may legally play right now (empty unless it's their turn). */
export function currentLegalPlays(state: DebercState): Card[] {
  if (state.phase !== 'playing') return [];
  const hand = state.players[state.turnSeat].hand;
  const ledSuit = state.currentTrick ? state.currentTrick.ledSuit : null;
  return legalPlays(hand, ledSuit, state.trumpSuit);
}
