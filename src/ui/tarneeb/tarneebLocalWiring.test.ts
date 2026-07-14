import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../../core/rng';
import type { Rng } from '../../core/rng';
import { tarneebReducer } from '../../games/tarneeb/engine';
import { tarneebBotAction } from '../../games/tarneeb/ai';
import {
  getActingTarneebSeat,
  getValidBids,
  getValidPlayableCards,
  nextSeatCounterClockwise,
  partnerOfSeat,
} from '../../games/tarneeb/rules';
import type { TarneebAction, TarneebState } from '../../games/tarneeb/types';
import { EN } from '../../i18n/dictionaries/en';
import { UK } from '../../i18n/dictionaries/uk';
import { DE } from '../../i18n/dictionaries/de';
import { AR } from '../../i18n/dictionaries/ar';

// No jsdom in this project, so the wiring is guarded at the source level plus a
// pure reducer-driven flow (the same reducer + bot the local UI uses).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const UI_FILES = [
  'TarneebLocalGame.tsx',
  'TarneebSetup.tsx',
  'TarneebGameScreen.tsx',
  'TarneebFinished.tsx',
  'TarneebHelp.tsx',
];

describe('App routes local Tarneeb to its own screen', () => {
  const app = read('../../App.tsx');
  it("routes gameType==='tarneeb' to TarneebLocalGame (not the King GameRouter)", () => {
    expect(app).toContain("mode.gameType === 'tarneeb'");
    expect(app).toContain('<TarneebLocalGame');
    expect(app).toContain("import TarneebLocalGame from './ui/tarneeb/TarneebLocalGame'");
    // King is still routed to its own LocalGame — behaviour unchanged.
    expect(app).toContain('<LocalGame />');
  });
});

describe('StartMenu — Tarneeb is selectable local AND online (released)', () => {
  const menu = read('../StartMenu.tsx');
  it('both the local and host pickers offer Tarneeb', () => {
    // The picker is data-driven over GAME_TYPES; Tarneeb is `available` and supports
    // both modes, so it is selectable in the local AND host sheets (Stage 19.3 gates
    // per mode on supportsLocal / supportsOnline).
    expect(menu).toContain('const options = GAME_TYPES.map((id) => {');
    expect(menu).toContain('<GamePicker gameType={gameType} onPick={setGameType} t={t} mode="local" />');
    expect(menu).toContain('<GamePicker gameType={gameType} onPick={setGameType} t={t} mode="host" />');
    // A game unusable in this mode is disabled — Tarneeb (available, both modes) is not.
    expect(menu).toContain('disabled: !usable');
  });
  it("host() sends gameType 'tarneeb' and still guards non-online games", () => {
    expect(menu).toContain("gameType === 'tarneeb' ? { gameType: 'tarneeb' as const, tarneebVariant }");
    // The generic supportsOnline guard stays (defensive; passes for Tarneeb now).
    expect(menu).toContain('if (!GAME_CATALOG[gameType].supportsOnline) return;');
  });
});

describe('TarneebLocalGame uses the pure core (no server state)', () => {
  const local = read('./TarneebLocalGame.tsx');
  it('drives play through tarneebReducer + tarneebBotAction', () => {
    expect(local).toContain('tarneebReducer');
    expect(local).toContain('tarneebBotAction');
    expect(local).toContain('getActingTarneebSeat');
    // The human is seat 0; seats 1–3 are bots (1 human + 3 bots).
    expect(local).toContain("['human', 'ai', 'ai', 'ai']");
  });
});

describe('Seating reads clockwise with the viewer at the bottom (Stage 27.4)', () => {
  const screen = read('./TarneebGameScreen.tsx');
  it('mirrors the seat offset so the successor sits on the left and the partner on top', () => {
    expect(screen).toContain("const POSITIONS = ['bottom', 'left', 'top', 'right']");
    // Mirrored (viewer − seat): the CCW-by-index engine order reads clockwise on screen.
    // See clockwiseAudit.test.ts + CLOCKWISE_AUDIT.md.
    expect(screen).toContain('POSITIONS[(viewerSeat - seat + 4) % 4]');
    // Legal cards flow from the pure rule generator (forced follow-suit).
    expect(screen).toContain('getValidPlayableCards(state, humanSeat)');
    // Bidding buttons come from the pure bid generator.
    expect(screen).toContain('getValidBids(state, humanSeat)');
  });
});

describe('Tarneeb UI never imports server / ws / db', () => {
  for (const f of UI_FILES) {
    it(`${f} has no server/online imports`, () => {
      const src = read(`./${f}`);
      // Only import lines matter; forbid the online/server/persistence seams.
      const importLines = src.split('\n').filter((l) => l.trimStart().startsWith('import'));
      for (const line of importLines) {
        expect(line).not.toMatch(/\/net\/|serverCore|wsHandlers|useNetworkGame|\/server|websocket|\bws\b|\/db\b/i);
      }
    });
  }
});

describe('i18n parity for the new Tarneeb keys', () => {
  const sampleKeys = [
    'tarneeb.phase.bidding',
    'tarneeb.chooseTrump',
    'tarneeb.nextHand',
    'tarneeb.onlineSoon',
    'tarneeb.teamUs',
  ];
  for (const dict of [EN, UK, DE, AR]) {
    it('every language defines the sampled Tarneeb keys (non-empty)', () => {
      for (const k of sampleKeys) {
        expect(dict[k]?.trim().length).toBeGreaterThan(0);
      }
    });
  }
});

// --- Pure UI-flow (reducer-driven, no jsdom) -------------------------------

function start(dealerSeat: number, rng: Rng): TarneebState {
  const action: TarneebAction = {
    type: 'START_GAME',
    playerNames: ['You', 'Bot 1', 'Bot 2', 'Bot 3'],
    playerTypes: ['human', 'ai', 'ai', 'ai'],
    dealerSeat,
  };
  return tarneebReducer(null, action, { rng }) as TarneebState;
}

describe('local START_GAME + bidding flow', () => {
  it('START_GAME opens a bidding hand; the dealer\'s right acts first', () => {
    const s = start(1, makeRng(7)); // dealer 1 → first bidder = seat 0 (the human)
    expect(s.phase).toBe('bidding');
    expect(s.currentSeat).toBe(nextSeatCounterClockwise(1));
    expect(s.currentSeat).toBe(0);
    // Every seat holds 13 cards.
    expect(s.handsBySeat.every((h) => h.length === 13)).toBe(true);
  });

  it('the human on turn can BID or PASS', () => {
    const s = start(1, makeRng(7)); // seat 0 acts first
    const valid = getValidBids(s, 0);
    expect(valid).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); // Stage 27.0: minimum bid is now 3
    const afterBid = tarneebReducer(s, { type: 'BID', amount: 7 }, { rng: makeRng(7) })!;
    expect(afterBid.highestBid).toEqual({ seat: 0, amount: 7 });
    const afterPass = tarneebReducer(s, { type: 'PASS_BID' }, { rng: makeRng(7) })!;
    expect(afterPass.passed[0]).toBe(true);
    expect(afterPass.currentSeat).not.toBe(0);
  });
});

describe('bot loop can reach a human action', () => {
  it('driving only the bots stops when the human (seat 0) must act', () => {
    // dealer 0 → first bidder = seat 3 (a bot); drive bots until the human acts.
    const rng = makeRng(7);
    let s = start(0, rng);
    let guard = 0;
    while (guard++ < 50) {
      const seat = getActingTarneebSeat(s);
      if (seat == null) break;            // hand_complete / finished
      if (seat === 0) break;              // the human must act
      s = tarneebReducer(s, tarneebBotAction(s, seat), { rng })!;
    }
    expect(guard).toBeLessThan(50);
    const seat = getActingTarneebSeat(s);
    // Either the human is now on turn, or the auction ended without them (all
    // three bots outbid/decided) — never an infinite bot loop.
    expect(seat === 0 || seat == null || s.players[seat].type === 'human').toBe(true);
  });
});

describe('forced follow-suit derives from getValidPlayableCards', () => {
  it('a seat holding the led suit may only play that suit', () => {
    // Drive a full auto game; at the first mid-trick follow spot, assert the
    // legal set is restricted to the led suit.
    const rng = makeRng(7);
    let s = start(2, rng);
    let checked = false;
    let guard = 0;
    while (guard++ < 4000 && s.phase !== 'game_finished') {
      if (s.phase === 'hand_complete') {
        s = tarneebReducer(s, { type: 'START_NEXT_HAND' }, { rng })!;
        continue;
      }
      const seat = getActingTarneebSeat(s)!;
      if (
        s.phase === 'playing' &&
        s.currentTrick &&
        s.currentTrick.plays.length > 0 &&
        s.currentTrick.ledSuit
      ) {
        const led = s.currentTrick.ledSuit;
        const hasLed = s.handsBySeat[seat].some((c) => c.suit === led);
        const valid = getValidPlayableCards(s, seat);
        if (hasLed) {
          expect(valid.length).toBeGreaterThan(0);
          expect(valid.every((c) => c.suit === led)).toBe(true);
          checked = true;
        }
      }
      s = tarneebReducer(s, tarneebBotAction(s, seat), { rng })!;
    }
    expect(checked).toBe(true);
  });
});

describe('a full local table (1 human seat + 3 bots) terminates', () => {
  it('auto-driving every actor reaches game_finished with a winning team', () => {
    const rng = makeRng(11);
    let s = start(0, rng);
    let guard = 0;
    while (guard++ < 20000 && s.phase !== 'game_finished') {
      if (s.phase === 'hand_complete') {
        s = tarneebReducer(s, { type: 'START_NEXT_HAND' }, { rng })!;
        continue;
      }
      const seat = getActingTarneebSeat(s)!;
      s = tarneebReducer(s, tarneebBotAction(s, seat), { rng })!;
    }
    expect(s.phase).toBe('game_finished');
    expect(s.winnerTeam === 'A' || s.winnerTeam === 'B').toBe(true);
    // Partners are opposite (fixed teams) — a sanity check on seating math.
    expect(partnerOfSeat(0)).toBe(2);
    expect(partnerOfSeat(1)).toBe(3);
  });
});

// --- Solo local mode (Stage 28.3) ------------------------------------------

function startSolo(dealerSeat: number, rng: Rng): TarneebState {
  const action: TarneebAction = {
    type: 'START_GAME',
    playerNames: ['You', 'Bot 1', 'Bot 2', 'Bot 3'],
    playerTypes: ['human', 'ai', 'ai', 'ai'],
    dealerSeat,
    variant: 'solo',
  };
  return tarneebReducer(null, action, { rng }) as TarneebState;
}

describe('local Tarneeb setup exposes Pairs (default) + Solo', () => {
  const setup = read('./TarneebSetup.tsx');
  const local = read('./TarneebLocalGame.tsx');
  it('setup offers both modes and defaults to Pairs', () => {
    expect(setup).toContain("t('tarneeb.modePairs')");
    expect(setup).toContain("t('tarneeb.modeSolo')");
    expect(setup).toContain("useState<TarneebVariant>('pairs')"); // default = pairs
    expect(setup).toContain('onStart(variant)');
  });
  it('the local game threads variant:solo ONLY for Solo (Pairs omits it → default)', () => {
    expect(local).toContain("...(variant === 'solo' ? { variant } : {})");
  });
});

describe('local Solo game (1 human + 3 bots) is playable and terminates', () => {
  it('opens bidding 3–13, and auto-driving every actor reaches an individual winner', () => {
    const rng = makeRng(29);
    let s = startSolo(1, rng); // dealer 1 → first bidder seat 0
    expect(s.variant).toBe('solo');
    expect(s.handsBySeat.every((h) => h.length === 13)).toBe(true);
    expect(getValidBids(s, 0)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    let guard = 0;
    while (guard++ < 20000 && s.phase !== 'game_finished') {
      if (s.phase === 'hand_complete') {
        s = tarneebReducer(s, { type: 'START_NEXT_HAND' }, { rng })!;
        continue;
      }
      const seat = getActingTarneebSeat(s)!;
      s = tarneebReducer(s, tarneebBotAction(s, seat), { rng })!;
    }
    expect(s.phase).toBe('game_finished');
    // Solo finishes with a UNIQUE seat winner (no team), per-seat scores present.
    expect(s.soloWinnerSeat).not.toBeNull();
    expect(s.winnerTeam).toBeNull();
    const scores = s.scoresBySeat!;
    expect(scores[s.soloWinnerSeat!]).toBe(Math.max(...scores));
  });
});

describe('Solo UI drops team labels; Pairs keeps them (source guards)', () => {
  const screen = read('./TarneebGameScreen.tsx');
  const finished = read('./TarneebFinished.tsx');
  it('the game screen branches on isSoloTarneeb and shows a ranked standings table', () => {
    expect(screen).toContain('const solo = isSoloTarneeb(state)');
    // Stage 29.7: the per-seat chip strip became a ranked table fed by the pure helper.
    expect(screen).toContain('tarneebRankRows(state, humanSeat, actingSeat, blocked)');
    expect(screen).toContain('tarneeb-rank--solo');
    expect(screen).toContain('tarneeb-rank--pairs');
    // My seat is "us" only in Pairs; Solo colours only my own seat (felt board seats).
    expect(screen).toContain("solo ? p.seatIndex === humanSeat : teamOfSeat(p.seatIndex) === myTeam");
    // Pairs rows are still labelled Us / Them; Solo uses player names.
    expect(screen).toContain("t('tarneeb.teamUs')");
    expect(screen).toContain("t('tarneeb.teamThem')");
  });
  it('finished screen has an individual Solo winner path + keeps the team path', () => {
    expect(finished).toContain('SoloFinished');
    expect(finished).toContain('state.soloWinnerSeat');
    expect(finished).toContain("kind={humanWon ? 'win' : 'loss'}");   // solo = individual win
    expect(finished).toContain("kind={humanWon ? 'teamWin' : 'loss'}"); // pairs = team win
  });
});

describe('i18n parity — the new Solo keys exist in every language', () => {
  const keys = ['tarneeb.mode', 'tarneeb.modePairs', 'tarneeb.modeSolo', 'tarneeb.modePairsDesc', 'tarneeb.modeSoloDesc', 'tarneeb.myTricks', 'tarneeb.playerWon'];
  for (const dict of [EN, UK, DE, AR]) {
    it('every language defines the sampled Solo keys (non-empty)', () => {
      for (const k of keys) expect(dict[k]?.trim().length).toBeGreaterThan(0);
    });
  }
});
