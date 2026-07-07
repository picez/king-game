// ---------------------------------------------------------------------------
// King bot A/B evaluation — plays full King games with ONE new-bot seat
// (`botAction` → improved aiChoose*) against THREE legacy-bot seats
// (`legacyKingBotAction`), rotating the new seat through every position on the
// SAME seeded deal to cancel positional luck. rng is threaded through every
// reducer call (START_GAME + each NEXT_ROUND re-deal) so runs are reproducible.
//
//   npx tsx scripts/king-ai-eval.mjs
//
// Win = highest cumulative total after all rounds (negative modes score
// negatively, Trump positively — see scoring.ts). Fair share for the single new
// seat = 1/players (25% at 4p, 33.3% at 3p). Ties split fractionally. A clearly
// stronger bot beats its fair share.
// ---------------------------------------------------------------------------

import { makeRng } from '../src/core/rng';
import { gameReducer, getCurrentPlayer } from '../src/core/gameEngine';
import { botAction as NEW } from '../src/net/botAction';
import { legacyKingBotAction as LEGACY } from '../src/core/ai';

const STEP_CAP = 8000;
const SEEDS = 500;

/** Seat that must act now: dealer for the setup steps, current player when playing. */
function actingSeat(s) {
  switch (s.status) {
    case 'mode_selection':
    case 'select_trump':
    case 'kitty_exchange':
      return s.dealerIndex;
    case 'playing':
      return getCurrentPlayer(s).seatIndex;
    default:
      return -1; // trick_complete / round_scoring / game_finished — system-driven
  }
}

/** Play one full game; `isNew[seat]` picks the improved bot for that seat. */
function playGame(names, seed, isNew) {
  let s = gameReducer(
    null,
    { type: 'START_GAME', playerNames: names, playerTypes: names.map(() => 'ai'), modeSelectionType: 'fixed' },
    { rng: makeRng(seed) },
  );
  let ctr = (seed * 2654435761) >>> 0;
  for (let step = 0; step < STEP_CAP; step++) {
    if (!s) throw new Error('null state');
    if (s.status === 'game_finished') break;
    if (s.status === 'trick_complete') { s = gameReducer(s, { type: 'NEXT_TRICK' }); continue; }
    if (s.status === 'round_scoring') {
      ctr = (ctr * 1103515245 + 12345) >>> 0;
      s = gameReducer(s, { type: 'NEXT_ROUND' }, { rng: makeRng(ctr) });
      continue;
    }
    const seat = actingSeat(s);
    const action = (isNew[seat] ? NEW : LEGACY)(s);
    if (!action) throw new Error(`no action at status=${s.status}`);
    s = gameReducer(s, action);
  }
  if (s.status !== 'game_finished') throw new Error(`game did not finish (stuck at ${s.status})`);
  const totals = s.players.map((p) => s.scores[p.id].total);
  const max = Math.max(...totals);
  const winners = totals.map((t, i) => (t === max ? i : -1)).filter((i) => i >= 0);
  return winners; // seat indices sharing the top total
}

function evalCount(n) {
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  let share = 0; // fractional wins credited to the single new seat
  let games = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (let newSeat = 0; newSeat < n; newSeat++) {
      const isNew = Array.from({ length: n }, (_, i) => i === newSeat);
      const winners = playGame(names, seed, isNew);
      if (winners.includes(newSeat)) share += 1 / winners.length;
      games++;
    }
  }
  return { rate: share / games, games, fair: 1 / n };
}

for (const n of [4, 3]) {
  const { rate, games, fair } = evalCount(n);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`${n}p: new-seat win share ${pct(rate)} over ${games} games (fair ${pct(fair)}) — ${rate > fair ? 'EDGE +' + pct(rate - fair) : 'no edge'}`);
}
