// ---------------------------------------------------------------------------
// CLOSED melds are folded away (Stage 39.1, owner request).
//
// "For convenience, hide the combinations that can no longer be extended — four nines
// without a joker, say — and show them on a button." The table is the one band that
// scrolls, so every meld a player can do nothing with costs room that the live melds need.
//
// "Closed" is a RULES question, so it is answered by the shared lay-off helper and never
// by counting cards in the UI.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import FiftyOneGameScreen from './FiftyOneGameScreen';
import { isMeldClosed, legalLayoffPlacements } from '../../games/fiftyOne/melds';
import type { FiftyOneCard, FiftyOneMeld, FiftyOneState } from '../../games/fiftyOne/types';
import type { Rank, Suit } from '../../models/types';

let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}`, joker: false, suit, rank });
const joker = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });
const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const run = (suit: Suit, ...ranks: Rank[]) => ranks.map((r) => c(r, suit));

describe('isMeldClosed — decided by the lay-off rules', () => {
  it('four of a kind without a joker is closed (the owner\'s example)', () => {
    expect(isMeldClosed(SUITS.map((s) => c('9', s)))).toBe(true);
  });

  it('three of a kind is open — the fourth suit can still join', () => {
    expect(isMeldClosed([c('9', 'spades'), c('9', 'hearts'), c('9', 'diamonds')])).toBe(false);
  });

  it('a full 2..A run is closed; a shorter run is open', () => {
    expect(isMeldClosed(run('clubs', ...RANKS))).toBe(true);
    expect(isMeldClosed(run('clubs', '6', '7', '8', '9'))).toBe(false);
    // Twelve cards: one end is still free.
    expect(isMeldClosed(run('clubs', ...RANKS.slice(1)))).toBe(false);
  });

  it('a meld holding a joker is never closed — the joker can still be bought back', () => {
    expect(isMeldClosed([c('9', 'spades'), c('9', 'hearts'), c('9', 'diamonds'), joker()])).toBe(false);
  });

  it('an empty or invalid meld is reported as open, so it stays in view', () => {
    expect(isMeldClosed([])).toBe(false);
    expect(isMeldClosed([c('6', 'spades'), c('7', 'spades'), c('6', 'clubs'), c('6', 'diamonds')])).toBe(false);
  });

  it('agrees with the lay-off helper for EVERY card in the deck, in both directions', () => {
    const fixtures = [
      SUITS.map((s) => c('9', s)),
      [c('K', 'spades'), c('K', 'hearts'), c('K', 'clubs')],
      run('hearts', ...RANKS),
      run('hearts', 'A', '2', '3'),
      run('diamonds', 'Q', 'K', 'A'),
      run('spades', '5', '6', '7', '8'),
    ];
    for (const cards of fixtures) {
      const anyLegal = [joker(), ...SUITS.flatMap((s) => RANKS.map((r) => c(r, s)))]
        .some((probe) => legalLayoffPlacements(cards, [probe]).length > 0);
      expect(isMeldClosed(cards), cards.map((x) => `${x.rank}${x.suit?.[0]}`).join(' ')).toBe(!anyLegal);
    }
  });
});

function meld(id: string, ownerSeat: number, cards: FiftyOneCard[], type: 'run' | 'set', value: number): FiftyOneMeld {
  return { id, ownerSeat, type, cards, value, jokerRepresents: {} } as FiftyOneMeld;
}

function state(publicMelds: FiftyOneMeld[]): FiftyOneState {
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount: 3,
    players: [0, 1, 2].map((i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: i === 0 ? 'human' : 'ai' })),
    dealerSeat: 0, starterSeat: 0, currentSeat: 0, turnStep: 'draw',
    handsBySeat: [[c('4', 'spades'), c('J', 'diamonds')], [], []],
    drawPile: [c('3', 'clubs')], discardPile: [c('9', 'clubs')],
    openedBySeat: [true, true, true],
    publicMelds,
    scoresBySeat: [0, 0, 0], eliminatedSeats: [false, false, false],
    roundNumber: 1, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
  } as unknown as FiftyOneState;
}

const render = (publicMelds: FiftyOneMeld[]) => renderToStaticMarkup(createElement(FiftyOneGameScreen, {
  state: state(publicMelds), humanSeat: 0, apply: () => {}, onExit: () => {},
} as never));

describe('the table folds closed melds away by default', () => {
  const nines = meld('nines', 1, SUITS.map((s) => c('9', s)), 'set', 36);
  const liveRun = meld('live', 1, run('spades', '6', '7', '8'), 'run', 21);
  const kings = meld('kings', 2, SUITS.map((s) => c('K', s)), 'set', 40);

  it('a closed meld is not rendered; a live one is', () => {
    const out = render([nines, liveRun]);
    expect((out.match(/fiftyone-meld__cards/g) ?? []).length).toBe(1);
    expect(out).toContain('Run · 21');
    expect(out).not.toContain('Set · 36');
  });

  it('one button says how many are folded, and it is not pressed', () => {
    const out = render([nines, liveRun, kings]);
    expect(out).toMatch(/class="[^"]*fiftyone-closed-toggle"[^>]*aria-pressed="false"/);
    expect(out).toContain('Show 2 closed melds');
  });

  it('the owner total still counts the folded meld — folding is not a score change', () => {
    const out = render([nines, liveRun]);
    expect(out).toContain('<span class="fiftyone-meldgroup__total">57</span>');   // 36 + 21
  });

  it('an owner whose melds are ALL closed has no group left on the table', () => {
    const out = render([liveRun, kings]);
    expect((out.match(/fiftyone-meldgroup"/g) ?? []).length).toBe(1);
    expect(out).toContain('Show 1 closed melds');
  });

  it('no closed melds → no button at all', () => {
    expect(render([liveRun])).not.toContain('fiftyone-closed-toggle');
  });

  it('even when EVERY meld is closed the button remains, so they can be brought back', () => {
    const out = render([nines, kings]);
    expect(out).toContain('fiftyone-closed-toggle');
    expect(out).not.toContain('fiftyone-meld__cards');
  });
});

describe('wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneGameScreen.tsx'), 'utf8');

  it('"closed" comes from the shared rules helper, never from a card count in the screen', () => {
    expect(src).toContain('isMeldClosed(m.cards)');
    expect(src).not.toMatch(/cards\.length\s*(===|>=)\s*(4|13)/);
  });

  it('the toggle is a real tap target and dispatches nothing', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/fiftyone.css'), 'utf8');
    expect(css).toMatch(/\.fiftyone-closed-toggle \{[^}]*min-height: 44px/);
    const button = src.slice(src.indexOf('fiftyone-closed-toggle'), src.indexOf('{meldGroups.map'));
    expect(button).toContain('setShowClosed((v) => !v)');
    expect(button).not.toContain('apply(');
  });

  it('both labels exist in all four languages', () => {
    for (const lang of ['en', 'uk', 'de', 'ar']) {
      const dict = readFileSync(join(process.cwd(), `src/i18n/dictionaries/${lang}.ts`), 'utf8');
      expect(dict, lang).toContain("'fiftyOne.closedShow'");
      expect(dict, lang).toContain("'fiftyOne.closedHide'");
    }
  });
});
