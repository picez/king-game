// ---------------------------------------------------------------------------
// King lookahead A/B evaluation — isolates the ENDGAME LOOKAHEAD gain.
//
// One seat plays cards via the endgame max-n search (`aiChooseCardLookahead`,
// which falls back to the greedy heuristic outside its gate); the other seats
// play cards via the shipped greedy heuristic (`aiChooseCard`). EVERY seat makes
// the identical setup decisions (mode / trump / kitty), so the only difference
// measured is card play. The lookahead seat rotates through every position on the
// SAME seeded deal to cancel positional luck; rng is threaded so runs reproduce.
//
//   npx tsx scripts/king-lookahead-eval.mjs
//
// Win = highest cumulative total after all rounds. Fair share for the single
// lookahead seat = 1/players. A real endgame edge beats its fair share.
// ---------------------------------------------------------------------------

import { makeRng } from '../src/core/rng';
import { gameReducer, getCurrentPlayer } from '../src/core/gameEngine';
import { aiChooseCard, aiChooseMode, aiChooseTrump, aiChooseKittyDiscards } from '../src/core/ai';
import { aiChooseCardLookahead } from '../src/core/lookahead';

const STEP_CAP = 8000;
const SEEDS = Number(process.env.SEEDS ?? 150);

/** Full action chooser; `useLookahead` swaps only the card-play policy. */
function action(s, useLookahead) {
  switch (s.status) {
    case 'mode_selection': {
      const dealer = s.players[s.dealerIndex];
      return { type: 'CHOOSE_MODE', modeId: aiChooseMode(s.dealerModes[dealer.id]) };
    }
    case 'select_trump': {
      const dealer = s.players[s.dealerIndex];
      return { type: 'SELECT_TRUMP', suit: aiChooseTrump(dealer.hand) };
    }
    case 'kitty_exchange': {
      const dealer = s.players[s.dealerIndex];
      return { type: 'EXCHANGE_KITTY', discards: aiChooseKittyDiscards(dealer.hand, s.config.kittySize, s.currentRound.mode.id) };
    }
    case 'playing': {
      const p = getCurrentPlayer(s);
      const card = useLookahead ? aiChooseCardLookahead(s) : aiChooseCard(s);
      return { type: 'PLAY_CARD', playerId: p.id, card };
    }
    default:
      return null;
  }
}

/** Seat that must act now (dealer for setup, current player when playing). */
function actingSeat(s) {
  switch (s.status) {
    case 'mode_selection':
    case 'select_trump':
    case 'kitty_exchange':
      return s.dealerIndex;
    case 'playing':
      return getCurrentPlayer(s).seatIndex;
    default:
      return -1;
  }
}

function playGame(names, seed, isLookahead) {
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
    s = gameReducer(s, action(s, isLookahead[seat]));
  }
  if (s.status !== 'game_finished') throw new Error(`game did not finish (stuck at ${s.status})`);
  const totals = s.players.map((p) => s.scores[p.id].total);
  const max = Math.max(...totals);
  return totals.map((t, i) => (t === max ? i : -1)).filter((i) => i >= 0);
}

function evalCount(n) {
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  let share = 0;
  let games = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (let seat = 0; seat < n; seat++) {
      const isLookahead = Array.from({ length: n }, (_, i) => i === seat);
      const winners = playGame(names, seed, isLookahead);
      if (winners.includes(seat)) share += 1 / winners.length;
      games++;
    }
  }
  return { rate: share / games, games, fair: 1 / n };
}

for (const n of [4, 3]) {
  const t0 = Date.now();
  const { rate, games, fair } = evalCount(n);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${n}p: lookahead-seat win share ${pct(rate)} over ${games} games (fair ${pct(fair)}) — ${rate > fair ? 'EDGE +' + pct(rate - fair) : 'no edge'} [${secs}s]`);
}
