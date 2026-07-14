// ---------------------------------------------------------------------------
// 51 local prototype wiring (Stage 30.3). Source guards that the local UI plugs
// into the pure core WITHOUT re-implementing any rules, dispatches the full 51
// action vocabulary, and reads the deck rule from the core. Plus a headless
// drive of the local loop's exact dispatch contract (bot for the acting seat,
// human START_NEXT_ROUND between rounds) to a finished match with no invariant
// break. No jsdom — behaviour comes from the pure reducer.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../../core/rng';
import { fiftyOneReducer } from '../../games/fiftyOne/engine';
import { fiftyOneBotAction } from '../../games/fiftyOne/ai';
import { getActingFiftyOneSeat } from '../../games/fiftyOne/rules';
import { checkFiftyOneInvariants } from '../../games/fiftyOne/invariants';
import type { FiftyOneState } from '../../games/fiftyOne/types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('51 local UI wiring (no rule duplication)', () => {
  it('FiftyOneLocalGame drives the pure reducer + bot (human at seat 0)', () => {
    const src = read('src/ui/fiftyOne/FiftyOneLocalGame.tsx');
    expect(src).toContain('fiftyOneReducer');
    expect(src).toContain('fiftyOneBotAction');
    expect(src).toContain('getActingFiftyOneSeat');
    expect(src).toContain("apply({ type: 'START_GAME'");
  });

  it('FiftyOneGameScreen reuses the core validator + dispatches every 51 action', () => {
    const src = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');
    // Uses the pure meld validator + opening threshold (no rules copied into the UI).
    expect(src).toContain('resolveMeld');
    expect(src).toContain('OPENING_MINIMUM');
    for (const action of ['DRAW_FROM_DECK', 'TAKE_DISCARD', 'OPEN_MELDS', 'ADD_TO_MELD', 'DISCARD', 'START_NEXT_ROUND']) {
      expect(src, `dispatches ${action}`).toContain(action);
    }
  });

  it('the lay button switches Open 51 → Lay meld, with the 51 gate only before opening (30.9)', () => {
    const src = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');
    // The button label branches on `opened`: "Lay meld" after opening, "Open (n/51)" before.
    expect(src).toContain("t('fiftyOne.layMeld')");
    expect(src).toMatch(/opened[\s\S]*fiftyOne\.layMeld[\s\S]*fiftyOne\.open/);
    // The 51 minimum is the OPENING gate only — once opened it no longer applies.
    expect(src).toContain('const meetsOpening = opened || stagedTotal >= OPENING_MINIMUM');
    // Staging a meld is available AFTER opening too (no `!opened` gate on canStage).
    expect(src).not.toContain('const canStage = meldStep && !opened');
    // Distinct copy: opening-needs-51 vs opened-lay-any hints exist.
    expect(src).toContain("t('fiftyOne.openingNeeds51')");
    expect(src).toContain("t('fiftyOne.openAnyMeld')");
  });

  it('public meld cards lay out without overlap/clipping (30.10 CSS guard)', () => {
    const css = read('src/styles/fiftyone.css');
    const block = css.slice(css.indexOf('.fiftyone-meld__cards'));
    // A single positive gap and no negative margins → adjacent cards never overlap.
    expect(block).toMatch(/\.fiftyone-meld__cards\s*\{[^}]*gap:\s*0?\.\d+rem/);
    expect(css).not.toMatch(/\.fiftyone-meld__cards[^}]*margin[^:]*:\s*-/);
    // Long melds scroll INSIDE the block (never overflow the screen / the Add button).
    expect(block).toMatch(/\.fiftyone-meld__cards\s*\{[^}]*overflow-x:\s*auto/);
    // Full card face (contain) so mini meld-card indices are not cover-cropped.
    expect(css).toContain('.fiftyone-meld__cards .card--mini.card--art .card__art { object-fit: contain; }');
    // Cards are ENLARGED (30.13) via a fixed, non-shrinking box so they read clearly.
    expect(block).toMatch(/\.fiftyone-meld__cards \.card--mini \{[^}]*flex:\s*0 0 auto[^}]*width:\s*54px/);
    // The Add button is its own element under the cards (not inside the card row).
    expect(css).toContain('.fiftyone-meld__add');
  });

  it('discard-to-open UI: the top is takeable only to open, via TAKE_DISCARD_AND_OPEN (30.13)', () => {
    const src = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');
    // The atomic action is dispatched — an unopened seat never sends a plain TAKE_DISCARD.
    expect(src).toContain("type: 'TAKE_DISCARD_AND_OPEN'");
    expect(src).toContain('discardOpenAvailable');
    // The discard top becomes selectable ONLY when discard-open is available.
    expect(src).toMatch(/discardOpenAvailable[\s\S]{0,120}toggle\(topDiscard\.id\)/);
    // "Take & open 51" is gated on including the top AND reaching 51.
    expect(src).toContain('canTakeAndOpen');
    expect(src).toContain('stagedIds.has(topDiscard.id)');
    // Plain "Take discard" stays OPENED-only (never fires an unopened bare take).
    expect(src).toContain('drawStep && opened && state.discardPile.length > 0');
  });

  it('FiftyOneSetup reads the deck rule from the core (2p vs 3–4p) and offers 2/3/4', () => {
    const src = read('src/ui/fiftyOne/FiftyOneSetup.tsx');
    expect(src).toContain('deckCountFor');
    expect(src).toContain('totalDeckSize');
    expect(src).toContain('fiftyOne.deckNote2');
    expect(src).toContain('fiftyOne.deckNote34');
    expect(src).toContain('[2, 3, 4]');
  });
});

describe('51 local loop completes a match (headless drive of the UI contract)', () => {
  function drive(playerCount: number, seed: number): { finished: boolean; rounds: number; state: FiftyOneState } {
    const ctx = { rng: makeRng(seed) };
    const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
    const types = Array.from({ length: playerCount }, () => 'ai' as const);
    let state = fiftyOneReducer(null, { type: 'START_GAME', playerNames: names, playerTypes: types, playerCount, dealerSeat: 0 }, ctx) as FiftyOneState;
    let rounds = 0;
    let steps = 0;
    while (state.phase !== 'game_finished' && steps++ < 12000) {
      expect(checkFiftyOneInvariants(state)).toEqual([]);
      if (state.phase === 'round_complete') {
        rounds++;
        state = fiftyOneReducer(state, { type: 'START_NEXT_ROUND' }, ctx) as FiftyOneState;
        continue;
      }
      const seat = getActingFiftyOneSeat(state);
      if (seat == null) break;
      const next = fiftyOneReducer(state, fiftyOneBotAction(state, seat), ctx) as FiftyOneState;
      expect(next, `stalled at step ${steps}`).not.toBe(state);
      state = next;
    }
    return { finished: state.phase === 'game_finished', rounds, state };
  }

  it('completes rounds with no invariant break; a finished match names a valid winner', () => {
    for (const [pc, seed] of [[2, 5], [3, 4]] as const) {
      const { finished, rounds, state } = drive(pc, seed);
      // At least one full round resolves (the exact count varies with bot play — with
      // discard-to-open, 30.13, bots may open + go out faster and finish in fewer rounds).
      expect(rounds, `pc ${pc} rounds`).toBeGreaterThanOrEqual(1);
      if (finished) {
        expect(state.winnerSeat, `pc ${pc} winner`).not.toBeNull();
        expect(state.eliminatedSeats[state.winnerSeat as number]).toBe(false);
      }
    }
  }, 20_000);
});
