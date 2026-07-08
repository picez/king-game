// ---------------------------------------------------------------------------
// King SETUP-search A/B evaluation — isolates the trump/kitty rollout gain.
//
// One seat makes its DEALER setup choices (trump suit + kitty discards) via the
// perfect-info rollout search (chooseTrumpLookahead / chooseKittyDiscardsLookahead);
// every other seat uses the static heuristics (aiChooseTrump / aiChooseKitty
// Discards). CARD PLAY is identical for all seats (plain aiChooseCard, no endgame
// lookahead), so the only thing measured is the setup decision. The search seat
// rotates through every position on the same seeded deals to cancel positional
// luck; rng is threaded so runs reproduce.
//
//   npx tsx scripts/king-setup-eval.mjs        (SEEDS env overrides the default)
//
// Win = highest cumulative total after all rounds. Fair share for the single
// search seat = 1/players. A real setup edge beats its fair share. (The effect is
// diluted: only the dealer chooses setup, so a seat exercises it ~1/n of rounds.)
// ---------------------------------------------------------------------------

import { makeRng } from '../src/core/rng';
import { gameReducer, getCurrentPlayer } from '../src/core/gameEngine';
import { aiChooseCard, aiChooseMode, aiChooseTrump, aiChooseKittyDiscards } from '../src/core/ai';
import { chooseTrumpLookahead, chooseKittyDiscardsLookahead } from '../src/core/setupSearch';

const STEP_CAP = 8000;
const SEEDS = Number(process.env.SEEDS ?? 80);

/** Full action chooser; the dealer's setup uses search only when it IS the search seat. */
function action(s, searchSeat) {
  const dealerSeat = s.players[s.dealerIndex].seatIndex;
  const useSearch = dealerSeat === searchSeat;
  switch (s.status) {
    case 'mode_selection': {
      const dealer = s.players[s.dealerIndex];
      return { type: 'CHOOSE_MODE', modeId: aiChooseMode(s.dealerModes[dealer.id]) };
    }
    case 'select_trump': {
      const dealer = s.players[s.dealerIndex];
      const suit = useSearch ? chooseTrumpLookahead(s) : aiChooseTrump(dealer.hand);
      return { type: 'SELECT_TRUMP', suit };
    }
    case 'kitty_exchange': {
      const dealer = s.players[s.dealerIndex];
      const discards = useSearch
        ? chooseKittyDiscardsLookahead(s)
        : aiChooseKittyDiscards(dealer.hand, s.config.kittySize, s.currentRound.mode.id);
      return { type: 'EXCHANGE_KITTY', discards };
    }
    case 'playing': {
      const p = getCurrentPlayer(s);
      return { type: 'PLAY_CARD', playerId: p.id, card: aiChooseCard(s) };
    }
    default:
      return null;
  }
}

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

function playGame(names, seed, searchSeat) {
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
    s = gameReducer(s, action(s, searchSeat));
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
      const winners = playGame(names, seed, seat);
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
  console.log(`${n}p: setup-search-seat win share ${pct(rate)} over ${games} games (fair ${pct(fair)}) — ${rate > fair ? 'EDGE +' + pct(rate - fair) : 'no edge'} [${secs}s]`);
}
