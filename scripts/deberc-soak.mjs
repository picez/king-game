// ---------------------------------------------------------------------------
// Deberc deterministic bot soak — runs the SAME pure reducer used by local &
// online play (no server, no network). For every (players × matchSize × seed)
// combo it plays a full bot-vs-bot match and asserts the DEBERC_RULES.md
// invariants on EVERY intermediate state, then that the match terminates with a
// valid winner (target reached, or a деберц jackpot).
//
//   npm run soak:deberc     (3/4 players × small/big × 30 seeds = 120 matches)
//
// Run with tsx so it can import the TS core directly.
// ---------------------------------------------------------------------------

import { makeRng } from '../src/core/rng';
import { debercReducer } from '../src/games/deberc/engine';
import { debercBotAction } from '../src/games/deberc/ai';

const SEED_COUNT = 30;           // ≥ 25, matching the Durak soak
const STEP_CAP = 20000;          // hard loop guard (a real 'big' match is far shorter)
const TARGET = { small: 510, big: 1020 };

const key = (c) => `${c.rank}${c.suit[0]}`;

/**
 * Every physical card the state accounts for (v1.1). tableTrumpCard is a
 * reference into the stock (3p) or the dealer's prykup/hand (4p); dealtHands and
 * declaredMelds are copies — none are counted separately. The прикуп packets hold
 * cards until they merge into hands on trump commit, so they are counted. A
 * completed trick's cards live in wonCards, so currentTrick is only counted while
 * it is a partial trick mid-play (phase 'playing').
 */
function allCards(s) {
  const cs = [...s.stock];
  for (const p of s.players) cs.push(...p.hand);
  for (const pk of s.prykup) cs.push(...pk);
  for (const won of s.wonCards) cs.push(...won);
  if (s.phase === 'playing' && s.currentTrick) {
    for (const play of s.currentTrick.plays) cs.push(play.card);
  }
  return cs;
}

let failures = 0;
function fail(msg) { console.error(`  ✗ ${msg}`); failures++; }

/** Throws on the first violated invariant (with context). */
function assertInvariants(s, ctx) {
  const cards = allCards(s);
  // v1.2: 3 players use a 32-card deck (no 6s); 4 players use the full 36.
  const expected = s.players.length === 4 ? 36 : 32;
  if (cards.length !== expected) throw new Error(`${ctx}: ${cards.length} cards (expected ${expected})`);
  if (new Set(cards.map(key)).size !== expected) throw new Error(`${ctx}: duplicate/missing card`);

  if (s.tricksPlayed < 0 || s.tricksPlayed > 9) throw new Error(`${ctx}: tricksPlayed ${s.tricksPlayed}`);
  if (s.currentTrick && s.currentTrick.plays.length > s.players.length) {
    throw new Error(`${ctx}: trick has ${s.currentTrick.plays.length} plays > ${s.players.length} seats`);
  }

  if (s.phase === 'declaring' || s.phase === 'playing' || s.phase === 'trick_complete' || s.phase === 'hand_scoring') {
    if (s.trumpSuit == null) throw new Error(`${ctx}: no trump in phase ${s.phase}`);
  }
  if (s.phase !== 'finished') {
    const actingSeat = s.phase === 'bidding' ? s.bidderSeat
      : s.phase === 'declaring' ? s.meldTurnSeat : s.turnSeat;
    if (!s.players[actingSeat]) throw new Error(`${ctx}: no acting player (phase ${s.phase})`);
  }
  // Match score never runs away past a plausible ceiling (penalty accounting sane).
  for (const v of s.matchScore) {
    if (!Number.isFinite(v)) throw new Error(`${ctx}: non-finite match score`);
  }
}

function playOut(n, matchSize, seed) {
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  const types = Array.from({ length: n }, () => 'ai');
  // One rng threaded through EVERY call so each hand's re-deal (NEXT_HAND) draws
  // from the same seeded stream — the whole match is reproducible from the seed.
  const ctx = { rng: makeRng(seed) };
  let s = debercReducer(null, { type: 'START_DEBERC', playerNames: names, playerTypes: types, matchSize }, ctx);
  if (!s) throw new Error(`START_DEBERC returned null (${n}p ${matchSize} seed ${seed})`);
  assertInvariants(s, `${n}p ${matchSize} #${seed} init`);

  let hands = 0;
  for (let step = 0; step < STEP_CAP; step++) {
    if (s.phase === 'finished') return { state: s, steps: step, hands };
    const action = debercBotAction(s);
    if (!action) throw new Error(`${n}p ${matchSize} #${seed}: no action while not finished (phase ${s.phase})`);
    if (action.type === 'NEXT_HAND') hands++;
    const next = debercReducer(s, action, ctx);
    if (next === s) throw new Error(`${n}p ${matchSize} #${seed}: illegal bot action (same ref): ${JSON.stringify(action)}`);
    if (next === null) throw new Error(`${n}p ${matchSize} #${seed}: reducer returned null`);
    s = next;
    assertInvariants(s, `${n}p ${matchSize} #${seed} step ${step}`);
  }
  throw new Error(`${n}p ${matchSize} #${seed}: did not finish within ${STEP_CAP} steps (loop?)`);
}

console.log(`Deberc bot soak — ${SEED_COUNT} seeds × [3,4] players × [small,big]\n`);

let matches = 0, jackpots = 0, totalSteps = 0, totalHands = 0, maxSteps = 0;

for (const n of [3, 4]) {
  for (const matchSize of ['small', 'big']) {
    let comboMatches = 0, comboJackpots = 0, comboSteps = 0, comboHands = 0;
    const winnerTeams = {};
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = 2000 + i * 7919; // spread seeds deterministically
      try {
        const { state, steps, hands } = playOut(n, matchSize, seed);
        if (state.winnerTeam == null) throw new Error(`${n}p ${matchSize} #${seed}: finished with no winnerTeam`);
        if (!state.jackpot && !state.matchScore.some((v) => v >= TARGET[matchSize])) {
          throw new Error(`${n}p ${matchSize} #${seed}: finished below target and not a jackpot`);
        }
        winnerTeams[state.winnerTeam] = (winnerTeams[state.winnerTeam] ?? 0) + 1;
        comboMatches++; comboSteps += steps; comboHands += hands;
        matches++; totalSteps += steps; totalHands += hands;
        if (state.jackpot) { comboJackpots++; jackpots++; }
        if (steps > maxSteps) maxSteps = steps;
      } catch (e) {
        fail(e.message);
      }
    }
    console.log(`  ✓ ${n}p ${matchSize}: ${comboMatches}/${SEED_COUNT} matches ok, ${comboJackpots} jackpots, avg ${Math.round(comboHands / Math.max(1, comboMatches))} hands / ${Math.round(comboSteps / Math.max(1, comboMatches))} steps, winner teams ${JSON.stringify(winnerTeams)}`);
  }
}

console.log(`\nTotals: ${matches} matches, ${jackpots} jackpots, avg ${Math.round(totalHands / Math.max(1, matches))} hands / ${Math.round(totalSteps / Math.max(1, matches))} steps, longest ${maxSteps} steps`);
console.log(failures === 0 ? '\nSOAK PASS ✅' : `\nSOAK FAIL ❌ (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
