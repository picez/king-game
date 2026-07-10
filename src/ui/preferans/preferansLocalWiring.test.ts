import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../../core/rng';
import type { Rng } from '../../core/rng';
import { preferansReducer } from '../../games/preferans/engine';
import { preferansBotAction } from '../../games/preferans/ai';
import { getActingPreferansSeat } from '../../games/preferans/rules';
import type { PreferansAction, PreferansState } from '../../games/preferans/types';
import { validBids } from './bids';
import { EN } from '../../i18n/dictionaries/en';
import { UK } from '../../i18n/dictionaries/uk';
import { DE } from '../../i18n/dictionaries/de';
import { AR } from '../../i18n/dictionaries/ar';

// No jsdom in this project, so the wiring is guarded at the source level plus a
// pure reducer-driven flow (the same reducer + bot the local UI uses).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const UI_FILES = [
  'PreferansLocalGame.tsx',
  'PreferansSetup.tsx',
  'PreferansGameScreen.tsx',
  'PreferansFinished.tsx',
  'PreferansHelp.tsx',
  'bids.ts',
];

describe('App routes local Preferans to its own screen', () => {
  const app = read('../../App.tsx');
  it("routes gameType==='preferans' to PreferansLocalGame (not the King GameRouter)", () => {
    expect(app).toContain("mode.gameType === 'preferans'");
    expect(app).toContain('<PreferansLocalGame');
    expect(app).toContain("import PreferansLocalGame from './ui/preferans/PreferansLocalGame'");
    // King is still routed to its own LocalGame — behaviour unchanged.
    expect(app).toContain('<LocalGame />');
  });
});

describe('StartMenu — Preferans is local-only (experimental), host stays disabled', () => {
  const menu = read('../StartMenu.tsx');
  it('the picker gates per mode so Preferans is selectable locally but not online', () => {
    expect(menu).toContain('const usable = mode === \'host\' ? entry.supportsOnline : entry.supportsLocal');
    expect(menu).toContain('disabled: !usable');
    expect(menu).toContain("t('menu.experimental')");
    expect(menu).toContain('mode="local"');
    expect(menu).toContain('mode="host"');
  });
  it('host() keeps the generic supportsOnline guard (now passes for Preferans, Stage 19.5)', () => {
    expect(menu).toContain('if (!GAME_CATALOG[gameType].supportsOnline) return;');
    // Preferans online is enabled (19.5) — host() now sends its gameType. The online
    // routing itself is guarded by preferansOnlineWiring.test.
    expect(menu).toContain("gameType === 'preferans' ? { gameType: 'preferans' as const }");
  });
});

describe('PreferansLocalGame uses the pure core (no server state)', () => {
  const local = read('./PreferansLocalGame.tsx');
  it('drives play through preferansReducer + preferansBotAction', () => {
    expect(local).toContain('preferansReducer');
    expect(local).toContain('preferansBotAction');
    expect(local).toContain('getActingPreferansSeat');
    // The human is seat 0; seats 1–2 are bots (1 human + 2 bots).
    expect(local).toContain("['human', 'ai', 'ai']");
  });
});

describe('Seating flows to the left with the viewer at the bottom', () => {
  const screen = read('./PreferansGameScreen.tsx');
  it('maps a seat offset to bottom/left/right (3 seats, not RTL-mirrored)', () => {
    expect(screen).toContain("const POSITIONS = ['bottom', 'left', 'right']");
    expect(screen).toContain('POSITIONS[(seat - viewerSeat + 3) % 3]');
    // Legal cards + bids flow from the pure generators.
    expect(screen).toContain('getValidPlayableCards(state, humanSeat)');
    expect(screen).toContain('validBids(state, humanSeat)');
    // Illegal cards are dimmed on the human's turn; discard needs exactly 2.
    expect(screen).toContain('dimmed={phase === \'playing\' && isMyTurn && !cardPlayable(c)}');
    expect(screen).toContain('selectedDiscards.length === 2');
  });

  it('surfaces clear prompts: follow-suit reminder + the declare minimum (Stage 19.4)', () => {
    // A follow-suit note shows only when the human still holds the led suit.
    expect(screen).toContain('const mustFollow = phase === \'playing\' && isMyTurn && ledSuit != null');
    expect(screen).toContain("t('preferans.mustFollow')");
    // The declare bar shows the minimum contract (= the winning bid).
    expect(screen).toContain("t('preferans.declareMin')");
    expect(screen).toContain('declareMinLabel');
    // The talon count / discard progress stays visible on the confirm button.
    expect(screen).toContain('({selectedDiscards.length}/2)');
  });
});

describe('Preferans UI never imports server / ws / db and records no stats', () => {
  for (const f of UI_FILES) {
    it(`${f} has no server/online/stats imports`, () => {
      const src = read(`./${f}`);
      const importLines = src.split('\n').filter((l) => l.trimStart().startsWith('import'));
      for (const line of importLines) {
        expect(line).not.toMatch(/\/net\/|serverCore|wsHandlers|useNetworkGame|\/server|websocket|\bws\b|\/db\b|stats/i);
      }
    });
  }
});

describe('i18n parity for the new Preferans keys', () => {
  const sampleKeys = [
    'preferans.phase.bidding',
    'preferans.takeTalon',
    'preferans.declareLabel',
    'preferans.declareMin',
    'preferans.mustFollow',
    'preferans.nextHand',
    'preferans.experimentalNote',
    'preferans.rule.play',
  ];
  for (const dict of [EN, UK, DE, AR]) {
    it('every language defines the sampled Preferans keys (non-empty)', () => {
      for (const k of sampleKeys) {
        expect(dict[k]?.trim().length).toBeGreaterThan(0);
      }
    });
  }
});

// --- Pure UI-flow (reducer-driven, no jsdom) -------------------------------

function start(dealerSeat: number, rng: Rng): PreferansState {
  const action: PreferansAction = {
    type: 'START_GAME',
    playerNames: ['You', 'Mira AI', 'Niko AI'],
    playerTypes: ['human', 'ai', 'ai'],
    options: { targetScore: 10 },
    dealerSeat,
  };
  return preferansReducer(null, action, { rng }) as PreferansState;
}

describe('local START_GAME + bidding flow', () => {
  it('START_GAME opens a bidding hand; the dealer\'s left acts first', () => {
    const s = start(2, makeRng(7)); // dealer 2 → first bidder = seat 0 (the human)
    expect(s.phase).toBe('bidding');
    expect(s.currentSeat).toBe(0);
    expect(s.handsBySeat.every((h) => h.length === 10)).toBe(true);
    expect(s.talon).toHaveLength(2);
  });

  it('the human on turn sees every shape as a legal opening bid, and can PASS', () => {
    const s = start(2, makeRng(7)); // seat 0 acts first
    const valid = validBids(s, 0);
    expect(valid).toHaveLength(25); // 5 levels × 5 suits, no high bid yet
    const afterBid = preferansReducer(s, { type: 'BID', level: valid[0].level, suit: valid[0].suit }, { rng: makeRng(7) })!;
    expect(afterBid.highBid).toMatchObject({ seat: 0, level: valid[0].level, suit: valid[0].suit });
    const afterPass = preferansReducer(s, { type: 'PASS_BID' }, { rng: makeRng(7) })!;
    expect(afterPass.passed[0]).toBe(true);
  });
});

describe('bot loop can reach a human action', () => {
  it('driving only the bots stops when the human (seat 0) must act (or the auction ends)', () => {
    const rng = makeRng(7);
    let s = start(1, rng); // dealer 1 → first bidder = seat 2 (a bot)
    let guard = 0;
    while (guard++ < 60) {
      const seat = getActingPreferansSeat(s);
      if (seat == null) break;         // hand_complete / finished
      if (seat === 0) break;           // the human must act
      s = preferansReducer(s, preferansBotAction(s, seat), { rng })!;
    }
    expect(guard).toBeLessThan(60);
    const seat = getActingPreferansSeat(s);
    expect(seat === 0 || seat == null || s.players[seat].type === 'human').toBe(true);
  });
});

describe('a full local table (1 human seat + 2 bots) terminates', () => {
  it('auto-driving every actor reaches game_finished (winner seat or a draw)', () => {
    const rng = makeRng(11);
    let s = start(0, rng);
    let guard = 0;
    while (guard++ < 40000 && s.phase !== 'game_finished') {
      if (s.phase === 'hand_complete') {
        s = preferansReducer(s, { type: 'START_NEXT_HAND' }, { rng })!;
        continue;
      }
      const seat = getActingPreferansSeat(s)!;
      s = preferansReducer(s, preferansBotAction(s, seat), { rng })!;
    }
    expect(s.phase).toBe('game_finished');
    // The match ends once a score reaches the target; winnerSeat is a seat or null (draw).
    expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(s.targetScore);
    expect(s.winnerSeat == null || (s.winnerSeat >= 0 && s.winnerSeat < 3)).toBe(true);
  });
});
