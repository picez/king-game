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

describe('StartMenu — Tarneeb is local-only', () => {
  const menu = read('../StartMenu.tsx');
  it('the local picker offers Tarneeb; the host picker disables it', () => {
    expect(menu).toContain("context: 'local' | 'host'");
    expect(menu).toContain("context === 'local'");
    // Local: selectable Tarneeb option; Host: disabled with an online-soon note.
    expect(menu).toContain("value: 'tarneeb'");
    expect(menu).toContain("t('tarneeb.onlineSoon'), icon: '♠️', disabled: true");
    expect(menu).toContain('<GamePicker gameType={gameType} onPick={setGameType} t={t} context="local"');
    expect(menu).toContain('<GamePicker gameType={gameType} onPick={setGameType} t={t} context="host"');
  });
  it('host() refuses a game with no online support (supportsOnline false respected)', () => {
    expect(menu).toContain('if (!GAME_CATALOG[gameType].supportsOnline) return;');
    expect(menu).toContain('disabled={!GAME_CATALOG[gameType].supportsOnline}');
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

describe('Seating is counter-clockwise with the viewer at the bottom', () => {
  const screen = read('./TarneebGameScreen.tsx');
  it('maps a seat offset to bottom/left/top/right so the partner sits on top', () => {
    expect(screen).toContain("const POSITIONS = ['bottom', 'left', 'top', 'right']");
    expect(screen).toContain('POSITIONS[(seat - viewerSeat + 4) % 4]');
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
    expect(valid).toEqual([7, 8, 9, 10, 11, 12, 13]);
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
