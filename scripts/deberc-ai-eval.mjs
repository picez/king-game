// ---------------------------------------------------------------------------
// Deberc bot A/B evaluation — plays the NEW `debercBotAction` head-to-head
// against the previous `legacyDebercBotAction` over many seeded matches, in both
// 3p and 4p (small & big), threading ONE seeded rng through EVERY reducer call
// (incl. NEXT_HAND — the engine falls back to Math.random otherwise) so results
// are reproducible. Seat/team assignment is rotated across seeds to cancel the
// first-mover / об'яз advantage. Prints the new bot's win-rate.
//
//   npx tsx scripts/deberc-ai-eval.mjs
//
// Fair baselines: 4p (new team vs legacy team) = 50%; 3p (1 new seat vs 2 legacy
// seats) = 33.3%. A clearly stronger bot beats those.
// ---------------------------------------------------------------------------

import { makeRng } from '../src/core/rng';
import { debercReducer } from '../src/games/deberc/engine';
import { debercBotAction as NEW, legacyDebercBotAction as LEGACY } from '../src/games/deberc/ai';

const STEP_CAP = 20000;
const SEEDS = 400;

function actingSeat(s) {
  if (s.phase === 'bidding') return s.bidderSeat;
  if (s.phase === 'declaring') return s.meldTurnSeat;
  if (s.phase === 'playing') return s.turnSeat;
  return -1; // trick_complete / hand_scoring / finished — no single actor
}

/** Play one full match; `botOf[seat]` picks the bot for that seat. Returns winnerTeam. */
function playMatch(n, matchSize, seed, botOf) {
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  const types = Array.from({ length: n }, () => 'ai');
  const ctx = { rng: makeRng(seed) };
  let s = debercReducer(null, { type: 'START_DEBERC', playerNames: names, playerTypes: types, matchSize }, ctx);
  for (let step = 0; step < STEP_CAP; step++) {
    if (s.phase === 'finished') return s.winnerTeam;
    const seat = actingSeat(s);
    const bot = seat >= 0 ? botOf[seat] : NEW; // ack phases: either bot returns the same NEXT_*
    const action = bot(s);
    const next = debercReducer(s, action, ctx);
    if (next === s || next === null) throw new Error(`stuck at ${s.phase} seed ${seed}`);
    s = next;
  }
  throw new Error(`match did not finish (seed ${seed})`);
}

function eval4p(matchSize) {
  let newWins = 0, total = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = 3000 + i * 7919;
    // Rotate which team is the new bot to cancel seat bias (teamOf = [0,1,0,1]).
    const newTeam = i % 2; // 0 → seats 0,2 ; 1 → seats 1,3
    const botOf = [0, 1, 2, 3].map((seat) => ((seat % 2) === newTeam ? NEW : LEGACY));
    const winner = playMatch(4, matchSize, seed, botOf);
    if (winner === newTeam) newWins++;
    total++;
  }
  return { rate: newWins / total, newWins, total };
}

function eval3p(matchSize) {
  let newWins = 0, total = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = 5000 + i * 7919;
    const newSeat = i % 3; // rotate the single new-bot seat
    const botOf = [0, 1, 2].map((seat) => (seat === newSeat ? NEW : LEGACY));
    const winner = playMatch(3, matchSize, seed, botOf); // winnerTeam == winning seat in 3p
    if (winner === newSeat) newWins++;
    total++;
  }
  return { rate: newWins / total, newWins, total };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

console.log('Deberc bot A/B — NEW vs LEGACY (higher = new is stronger)\n');
let ok = true;
for (const size of ['small', 'big']) {
  const r4 = eval4p(size);
  const r3 = eval3p(size);
  console.log(`  4p ${size}: new team win-rate ${pct(r4.rate)}  (fair 50.0%, ${r4.newWins}/${r4.total})`);
  console.log(`  3p ${size}: new seat win-rate ${pct(r3.rate)}  (fair 33.3%, ${r3.newWins}/${r3.total})`);
  if (r4.rate < 0.55) ok = false;
  if (r3.rate < 0.40) ok = false; // 1-vs-2: clearly above the 33.3% fair share
}
console.log(ok ? '\nA/B PASS ✅ (new bot clearly stronger)' : '\nA/B: new bot not clearly ahead ❌');
process.exit(ok ? 0 : 1);
