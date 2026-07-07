// ---------------------------------------------------------------------------
// Durak deterministic bot soak — runs the SAME pure reducer used by local &
// online play (no server, no network). For every (players × variant × seed)
// combo it plays a full bot-vs-bot game and asserts the DURAK_RULES.md
// invariants on EVERY intermediate state, then that the game terminates with a
// valid fool/draw result.
//
//   npm run soak          (2/3/4 players × simple/transfer × 30 seeds = 540 games)
//
// Run with tsx so it can import the TS core directly.
// ---------------------------------------------------------------------------

import { makeRng } from '../src/core/rng';
import { durakReducer } from '../src/games/durak/engine';
import { durakBotAction } from '../src/games/durak/ai';
import { beats } from '../src/games/durak/rules';

const SEED_COUNT = 30;            // ≥ 25 required by the audit
const STEP_CAP = 8000;            // hard loop guard (a real game is far shorter)

const key = (c) => `${c.rank}${c.suit[0]}`;

function allCards(s) {
  const cs = [...s.drawPile, ...s.discardPile];
  for (const p of s.players) cs.push(...p.hand);
  for (const pair of s.table) { cs.push(pair.attack); if (pair.defense) cs.push(pair.defense); }
  return cs;
}

let failures = 0;
function fail(msg) { console.error(`  ✗ ${msg}`); failures++; }

/** Throws on the first violated invariant (with context). */
function assertInvariants(s, ctx) {
  const cards = allCards(s);
  if (cards.length !== 36) throw new Error(`${ctx}: ${cards.length} cards (expected 36)`);
  if (new Set(cards.map(key)).size !== 36) throw new Error(`${ctx}: duplicate/missing card`);
  if (s.boutLimit > 6) throw new Error(`${ctx}: boutLimit ${s.boutLimit} > 6`);
  if (s.table.length > s.boutLimit) throw new Error(`${ctx}: table ${s.table.length} > boutLimit ${s.boutLimit}`);
  for (const pair of s.table) {
    if (pair.defense && !beats(pair.defense, pair.attack, s.trumpSuit)) {
      throw new Error(`${ctx}: illegal beat ${key(pair.defense)} over ${key(pair.attack)}`);
    }
  }
  if (s.status !== 'finished') {
    if (s.attackerIndex === s.defenderIndex) throw new Error(`${ctx}: attacker === defender`);
    if (s.throwerIndex === s.defenderIndex) throw new Error(`${ctx}: defender is the thrower`);
    // The acting player must exist and (when defending) be the defender.
    const actingIdx = (s.status === 'attack' || s.status === 'taking') ? s.throwerIndex : s.defenderIndex;
    if (!s.players[actingIdx]) throw new Error(`${ctx}: no acting player`);
  }
}

function playOut(n, variant, seed) {
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  let s = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant }, { rng: makeRng(seed) });
  if (!s) throw new Error(`START_DURAK returned null (${n}p ${variant} seed ${seed})`);
  assertInvariants(s, `${n}p ${variant} #${seed} init`);
  for (let step = 0; step < STEP_CAP; step++) {
    if (s.status === 'finished') return { state: s, steps: step };
    const action = durakBotAction(s);
    if (!action) throw new Error(`${n}p ${variant} #${seed}: no action while not finished (status ${s.status})`);
    const next = durakReducer(s, action);
    if (next === s) throw new Error(`${n}p ${variant} #${seed}: illegal bot action (same ref): ${JSON.stringify(action)}`);
    if (next === null) throw new Error(`${n}p ${variant} #${seed}: reducer returned null`);
    s = next;
    assertInvariants(s, `${n}p ${variant} #${seed} step ${step}`);
  }
  throw new Error(`${n}p ${variant} #${seed}: did not finish within ${STEP_CAP} steps (loop?)`);
}

console.log(`Durak bot soak — ${SEED_COUNT} seeds × [2,3,4] players × [simple,transfer]\n`);

let games = 0, draws = 0, totalSteps = 0, maxSteps = 0;
const foolCounts = {}; // per combo, fool seat distribution (sanity: not always one seat)

for (const n of [2, 3, 4]) {
  for (const variant of ['simple', 'transfer']) {
    let comboGames = 0, comboDraws = 0, comboSteps = 0;
    const foolSeats = {};
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = 1000 + i * 7919; // spread seeds deterministically
      try {
        const { state, steps } = playOut(n, variant, seed);
        // Result validity.
        if (state.drawPile.length !== 0) throw new Error(`${n}p ${variant} #${seed}: deck not empty at finish`);
        if (state.table.length !== 0) throw new Error(`${n}p ${variant} #${seed}: table not empty at finish`);
        if (state.isDraw) {
          if (state.foolId !== null) throw new Error(`${n}p ${variant} #${seed}: draw but foolId set`);
        } else {
          if (state.foolId === null) throw new Error(`${n}p ${variant} #${seed}: no fool and not a draw`);
          if (state.winnerIds.includes(state.foolId)) throw new Error(`${n}p ${variant} #${seed}: fool listed as winner`);
          if (state.winnerIds.length !== n - 1) throw new Error(`${n}p ${variant} #${seed}: winners ${state.winnerIds.length} != ${n - 1}`);
          const seat = state.foolId.split('-')[1];
          foolSeats[seat] = (foolSeats[seat] ?? 0) + 1;
        }
        comboGames++; comboSteps += steps; games++; totalSteps += steps;
        if (state.isDraw) { comboDraws++; draws++; }
        if (steps > maxSteps) maxSteps = steps;
      } catch (e) {
        fail(e.message);
      }
    }
    foolCounts[`${n}p ${variant}`] = foolSeats;
    console.log(`  ✓ ${n}p ${variant}: ${comboGames}/${SEED_COUNT} games ok, ${comboDraws} draws, avg ${Math.round(comboSteps / Math.max(1, comboGames))} steps, fool seats ${JSON.stringify(foolSeats)}`);
  }
}

console.log(`\nTotals: ${games} games, ${draws} draws, avg ${Math.round(totalSteps / Math.max(1, games))} steps, longest ${maxSteps} steps`);
console.log(failures === 0 ? '\nSOAK PASS ✅' : `\nSOAK FAIL ❌ (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
