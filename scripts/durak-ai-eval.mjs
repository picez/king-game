// ---------------------------------------------------------------------------
// Durak bot head-to-head: NEW durakBotAction vs the LEGACY baseline.
//   npm exec tsx scripts/durak-ai-eval.mjs      (or: npx tsx scripts/…)
//
// Each turn the action is produced by whichever bot owns the ACTING seat, so a
// game is a genuine new-vs-legacy contest. Seats are rotated across seeds to
// cancel any first-mover edge. The loser is the fool; we report the NEW bot's
// non-fool rate (fair = 50% in 2p heads-up; higher = stronger). rng is threaded
// into START_DURAK exactly like scripts/durak-soak.mjs (no mid-game reshuffle).
// ---------------------------------------------------------------------------

import { makeRng } from '../src/core/rng';
import { durakReducer } from '../src/games/durak/engine';
import { durakBotAction, legacyDurakBotAction } from '../src/games/durak/ai';

const STEP_CAP = 8000;
const SEEDS = 400;

/** The seat that must act right now. */
function actingSeat(s) {
  return (s.status === 'attack' || s.status === 'taking') ? s.throwerIndex : s.defenderIndex;
}

/** Play one game; `newSeats` = set of seats driven by the NEW bot. Returns foolSeat|null. */
function playOut(n, variant, seed, newSeats) {
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  let s = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant }, { rng: makeRng(seed) });
  for (let step = 0; step < STEP_CAP && s.status !== 'finished'; step++) {
    const seat = actingSeat(s);
    const bot = newSeats.has(seat) ? durakBotAction : legacyDurakBotAction;
    const action = bot(s);
    if (!action) throw new Error(`no action (status ${s.status})`);
    const next = durakReducer(s, action);
    if (next === s || next === null) throw new Error(`illegal action ${JSON.stringify(action)}`);
    s = next;
  }
  if (s.status !== 'finished') throw new Error('did not finish');
  return s.isDraw ? null : Number(s.foolId.split('-')[1]);
}

function evalCombo(n, variant) {
  let games = 0, newFool = 0, draws = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = 5000 + i * 7919;
    // Rotate which seat(s) the NEW bot drives so orientation cancels out.
    // 2p: alternate seat 0/1. 3-4p: NEW drives exactly one rotating seat.
    const newSeat = i % n;
    const foolSeat = playOut(n, variant, seed, new Set([newSeat]));
    games++;
    if (foolSeat === null) draws++;
    else if (foolSeat === newSeat) newFool++;
  }
  const nonFool = (games - newFool) / games;
  return { games, newFool, draws, nonFool };
}

console.log(`Durak AI eval — NEW vs LEGACY, ${SEEDS} seeds per combo\n`);
for (const n of [2, 3, 4]) {
  for (const variant of ['simple', 'transfer']) {
    const r = evalCombo(n, variant);
    const fair = n === 2 ? '50%' : `${Math.round(100 / n)}% fool-share`;
    console.log(
      `  ${n}p ${variant}: NEW non-fool ${(r.nonFool * 100).toFixed(1)}%  ` +
      `(${r.newFool} fools / ${r.games}, ${r.draws} draws; fair ${fair})`,
    );
  }
}
