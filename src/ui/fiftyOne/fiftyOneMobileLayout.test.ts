import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import FiftyOneGameScreen from './FiftyOneGameScreen';
import type { FiftyOneCard, FiftyOneMeld, FiftyOneState } from '../../games/fiftyOne/types';
import type { Rank, Suit } from '../../models/types';

// Stage 38.0.4 fixed the CLIPPED meld cards; Stage 38.0.5.1 answers the owner's follow-up
// FAILs: the docked social toolbar ate a band of the phone screen and read as clutter, and
// the public melds looked like a stack of heavy dark blocks each repeating the owner's name
// instead of cards lying on a table.
//
// The pairwise rectangle proof (every card, its inner `.card`, its `.card__art`, the joker
// badge, the controls, the sheet, the prompt/actions/hand) lives in
// `scripts/fiftyone-layout-qa.mjs` — a real browser, real `getBoundingClientRect()`, with a
// `--legacy` switch that reproduces the RED. These tests pin the CONTRACT that makes that
// geometry possible, so a refactor cannot quietly undo it.

const html = (el: ReactElement) => renderToStaticMarkup(el);
let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}`, joker: false, suit, rank });
const joker = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });

function meld(
  id: string, ownerSeat: number, cards: FiftyOneCard[],
  opts: { jokerAt?: number; type?: 'run' | 'set'; value?: number } = {},
): FiftyOneMeld {
  return {
    id, ownerSeat, type: opts.type ?? 'run', cards, value: opts.value ?? 30,
    jokerRepresents: opts.jokerAt == null ? {} : { [opts.jokerAt]: { suit: 'hearts', rank: '7' } },
  } as FiftyOneMeld;
}

/** The worst-case public table: two melds for ONE owner, a 7-run with a joker, duplicates. */
function melds(players: number): FiftyOneMeld[] {
  const seat = (i: number) => Math.min(i, players - 1);
  return [
    meld('m1', seat(1), [c('Q', 'hearts'), c('Q', 'clubs'), c('Q', 'diamonds')], { type: 'set', value: 36 }),
    meld('m2', seat(1), [c('6', 'spades'), c('7', 'spades'), c('8', 'spades'), c('9', 'spades')], { value: 30 }),
    meld('m3', seat(2), [
      c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts'), joker(),
      c('8', 'hearts'), c('9', 'hearts'), c('10', 'hearts'),
    ], { jokerAt: 3, value: 52 }),
    // Duplicate physical cards from the SECOND deck (same rank+suit as m2's 6♠).
    meld('m4', seat(3), [c('6', 'spades'), c('6', 'clubs'), c('6', 'diamonds'), c('6', 'hearts')], { type: 'set', value: 24 }),
  ];
}

function state(players = 4, over: Partial<FiftyOneState> = {}): FiftyOneState {
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount: players,
    players: Array.from({ length: players }, (_, i) => ({
      id: `player-${i}`, name: i === 1 ? 'A-player-with-a-really-long-display-name' : `P${i}`,
      seatIndex: i, type: i === 0 ? 'human' : 'ai',
    })),
    dealerSeat: 0, starterSeat: 0, currentSeat: 0, turnStep: 'draw',
    handsBySeat: Array.from({ length: players }, (_, i) => (i === 0 ? [c('4', 'spades'), c('J', 'diamonds')] : [])),
    drawPile: [c('3', 'clubs')], discardPile: [c('9', 'clubs')],
    openedBySeat: Array.from({ length: players }, () => true),
    publicMelds: melds(players),
    scoresBySeat: Array.from({ length: players }, () => 30),
    eliminatedSeats: Array.from({ length: players }, () => false),
    roundNumber: 3, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
    ...over,
  } as unknown as FiftyOneState;
}

const screen = (over: Record<string, unknown> = {}) => createElement(FiftyOneGameScreen, {
  state: state(), humanSeat: 0, apply: () => {}, onExit: () => {}, ...over,
} as never);

describe('every meld card is rendered — nothing is hidden behind an inner scroll', () => {
  it('a 3-card set and a 4-card run render ALL their cards', () => {
    const out = html(screen());
    // Each meld card is a `.fiftyone-meldcard` slot; 3 + 4 + 7 + 4 = 18 across the table.
    expect((out.match(/fiftyone-meldcard/g) ?? []).length).toBeGreaterThanOrEqual(18);
    expect((out.match(/fiftyone-meld__cards/g) ?? []).length).toBe(4);
  });

  it('a long 7-card run renders all seven (it wraps rather than scrolling)', () => {
    const out = html(screen());
    const runBlock = out.split('fiftyone-meld__cards')[3] ?? '';
    expect((runBlock.match(/fiftyone-meldcard/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it('a joker keeps its badge INSIDE its own slot', () => {
    expect(html(screen())).toContain('fiftyone-meldcard__jbadge');
  });

  it('duplicate cards from the second deck each get their own slot', () => {
    const out = html(screen());
    expect((out.match(/fiftyone-meldcard/g) ?? []).length).toBeGreaterThanOrEqual(18);
  });

  it('works for 2, 3 and 4 players', () => {
    for (const players of [2, 3, 4]) {
      const out = html(createElement(FiftyOneGameScreen, {
        state: state(players), humanSeat: 0, apply: () => {}, onExit: () => {},
      } as never));
      expect(out, `${players} players`).toContain('fiftyone-meld__cards');
    }
  });

  it('a meld that GREW by an add-to-meld renders the extra card in the same row', () => {
    const grown = state();
    const target = grown.publicMelds[1];
    // The server appends to `meld.cards`; the display must never re-sort it (51_RULES §5).
    const after = { ...target, cards: [...target.cards, c('10', 'spades')], value: 40 };
    const out = html(createElement(FiftyOneGameScreen, {
      state: { ...grown, publicMelds: [grown.publicMelds[0], after, ...grown.publicMelds.slice(2)] },
      humanSeat: 0, apply: () => {}, onExit: () => {},
    } as never));
    const rows = out.split('fiftyone-meld__cards');
    expect((rows[2].match(/fiftyone-meldcard/g) ?? []).length).toBe(5);
  });
});

describe('melds are GROUPED BY OWNER — one name, one total, compact rows', () => {
  it('one group per owner, not one panel per meld', () => {
    const out = html(screen());
    // 4 melds owned by 3 seats → 3 groups.
    expect((out.match(/fiftyone-meldgroup"/g) ?? []).length).toBe(3);
    expect((out.match(/class="fiftyone-meld"/g) ?? []).length).toBe(4);
  });

  it('an owner with TWO melds is named exactly once, with a combined total', () => {
    const out = html(screen());
    const long = 'A-player-with-a-really-long-display-name';
    const region = out.slice(out.indexOf('fiftyone-melds'), out.indexOf('fiftyone-prompt'));
    // Exactly ONE visible owner heading for that seat (the old UI repeated it per meld).
    expect((region.match(new RegExp(`fiftyone-meldgroup__owner">${long}`, 'g')) ?? []).length).toBe(1);
    expect(out).toContain('<span class="fiftyone-meldgroup__total">66</span>');   // 36 + 30
  });

  it('each meld inside a group carries a compact Run/Set + value label', () => {
    const out = html(screen());
    expect((out.match(/fiftyone-meld__label/g) ?? []).length).toBe(4);
    expect(out).toContain('Set · 36');
    expect(out).toContain('Run · 30');
  });

  it('an eliminated owner is marked on the GROUP, not on every meld', () => {
    const s = state();
    s.eliminatedSeats[1] = true;
    const out = html(createElement(FiftyOneGameScreen, {
      state: s, humanSeat: 0, apply: () => {}, onExit: () => {},
    } as never));
    expect((out.match(/fiftyone-meldgroup--out/g) ?? []).length).toBe(1);
  });

  it('the viewer\'s own group says "You", and card order is never re-sorted', () => {
    const s = state();
    s.publicMelds = [meld('mine', 0, [c('5', 'clubs'), joker(), c('7', 'clubs')], { jokerAt: 1 })];
    const out = html(createElement(FiftyOneGameScreen, {
      state: s, humanSeat: 0, apply: () => {}, onExit: () => {},
    } as never));
    expect(out).toContain('fiftyone-meldgroup__owner');
    // The joker sits at index 1 — mid-run — exactly where the rules put it.
    const row = out.split('fiftyone-meld__cards')[1];
    const jokerPos = row.indexOf('fiftyone-meldcard--joker');
    expect(jokerPos).toBeGreaterThan(row.indexOf('fiftyone-meldcard'));
  });

  it('table controls are compact icons and appear ONLY when the action is possible', () => {
    // Draw step / nothing selected → no Add, no Replace, and therefore no controls row.
    expect(html(screen())).not.toContain('fiftyone-meld__ctrls');
    const src = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneGameScreen.tsx'), 'utf8');
    // No repeated full-width labelled button under each meld any more.
    expect(src).not.toMatch(/fiftyone-meld__add[\s\S]{0,120}\{t\('fiftyOne\.addToMeld'\)\}\s*\n/);
    expect(src).toMatch(/fiftyone-meld__add[\s\S]{0,200}aria-label=\{t\('fiftyOne\.addToMeld'\)\}/);
    expect(src).toMatch(/\{\(addable \|\| swap\) && \(/);
  });
});

describe('the meld stylesheet cannot re-create the clipping', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/fiftyone.css'), 'utf8');
  const block = css.slice(css.indexOf('.fiftyone-melds {'), css.indexOf('.fiftyone-selbuilder'));

  it('the artificial 18rem cap is still gone and a group takes the full phone row', () => {
    expect(css).not.toContain('max-width: min(100%, 18rem)');
    expect(css).toMatch(/\.fiftyone-meldgroup \{[^}]*flex: 1 1 100%/);
  });

  it('the card row WRAPS instead of scrolling inside itself', () => {
    const row = css.slice(css.indexOf('.fiftyone-meld__cards {'), css.indexOf('.fiftyone-meld__cards >'));
    expect(row).toContain('flex-wrap: wrap');
    expect(row).not.toContain('overflow-x: auto');
    expect(row).not.toContain('nowrap');
  });

  it('card width is responsive, and 5 cards fit ONE row at 360 and 390', () => {
    expect(css).toMatch(/--f51-meld-card-w:\s*clamp\(46px, 15vw, 66px\)/);
    expect(css).toMatch(/--f51-meld-card-h:\s*calc\(var\(--f51-meld-card-w\)/);
    for (const vw of [360, 390]) {
      const w = Math.min(Math.max(46, vw * 0.15), 66);
      const gap = 6.4;
      // screen padding 8×2, group padding ~6.4×2 → the row's usable width.
      const usable = vw - 16 - 12.8;
      expect(5 * w + 4 * gap, `${vw}px`).toBeLessThan(usable);
    }
  });

  it('no negative margin, no transform and no card container hides overflow', () => {
    expect(block).not.toMatch(/margin:\s*-/);
    expect(block).not.toMatch(/margin-(left|right|inline-start|inline-end):\s*-/);
    expect(block).toMatch(/transform: none/);          // the existing anti-overlap guard
    // No CARD container may mask its content. (`overflow: hidden` is allowed on the
    // owner NAME only, where it is a text ellipsis for a long display name.)
    for (const sel of ['.fiftyone-meldgroup {', '.fiftyone-meld {', '.fiftyone-meld__cards {',
      '.fiftyone-meld__cards > * {', '.fiftyone-meldcard {']) {
      const at = css.indexOf(sel);
      expect(at, sel).toBeGreaterThan(-1);
      const rule = css.slice(at, css.indexOf('}', at));
      expect(rule, sel).not.toMatch(/overflow[^:]*:\s*(hidden|auto|scroll)/);
    }
    const nameRule = css.slice(css.indexOf('.fiftyone-meldgroup__owner {'));
    expect(nameRule.slice(0, nameRule.indexOf('}'))).toContain('text-overflow: ellipsis');
  });

  it('cards keep a positive gap and meld controls stay a real tap target', () => {
    expect(css).toMatch(/--f51-meld-gap:\s*0\.4rem/);
    expect(css).toMatch(/\.fiftyone-meld__ctrls button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.fiftyone-meld__ctrls button \{[^}]*min-width: 44px/);
  });

  it('the run order is never mirrored under RTL', () => {
    const row = css.slice(css.indexOf('.fiftyone-meld__cards {'), css.indexOf('.fiftyone-meld__cards >'));
    expect(row).toContain('direction: ltr');
  });

  it('the old in-flow social dock is gone entirely', () => {
    expect(css).not.toContain('.fiftyone-social-dock');
  });
});

describe('the social UI is ONE in-flow block (Stage 38.0.14)', () => {
  const screenSrc = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneGameScreen.tsx'), 'utf8');
  const onlineSrc = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneOnlineGame.tsx'), 'utf8');
  const localSrc = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneLocalGame.tsx'), 'utf8');
  const roomSrc = readFileSync(join(process.cwd(), 'src/ui/online/OnlineGame.tsx'), 'utf8');
  const socialSrc = readFileSync(join(process.cwd(), 'src/ui/online/RoomSocial.tsx'), 'utf8');

  it('(38.0.14) the social block sits IN FLOW after the melds, before the prompt', () => {
    const out = html(screen({
      socialSlot: createElement('div', { className: 'probe-menu' }),
      timerSlot: createElement('div', { className: 'probe-timer' }),
    }));
    const topbar = out.indexOf('fiftyone-topbar');
    const menu = out.indexOf('probe-menu');
    const melds = out.indexOf('fiftyone-melds');
    const prompt = out.indexOf('fiftyone-prompt');
    // After the public melds and BEFORE the prompt/actions/hand: opening the chat costs
    // layout space there and can never cover them (the Stage 38.0.14 owner FAIL).
    expect(melds).toBeGreaterThan(topbar);
    expect(menu).toBeGreaterThan(melds);
    expect(menu).toBeLessThan(prompt);
    expect(out).toContain('probe-timer');
  });

  it('there is NO toolbar row left between the melds and the prompt', () => {
    const out = html(screen({ menuSlot: createElement('div', { className: 'probe-menu' }) }));
    expect(out).not.toContain('fiftyone-social-dock');
    const between = out.slice(out.indexOf('fiftyone-melds'), out.indexOf('fiftyone-prompt'));
    expect(between).not.toContain('probe-menu');
    expect(between).not.toContain('social-controls');
  });

  it('without a slot nothing extra is rendered (local play is untouched)', () => {
    const out = html(screen());
    expect(out).not.toContain('fiftyone-topbar__menu');
    expect(out).not.toContain('fiftyone-topbar__timer');
    expect(out).not.toContain('social-');
  });

  it('online 51 mounts ONE in-flow RoomSocial, with the danger slot', () => {
    const from = roomSrc.indexOf("if (net.room?.gameType === 'fifty-one')");
    const to = roomSrc.indexOf("if (net.room?.gameType === 'poker')");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const branch = roomSrc.slice(from, to);
    // (38.0.14) No layout variants left (VoiceControl keeps its own unrelated `variant`).
    expect(branch).not.toContain('variant="sheet"');
    expect(branch).not.toContain('variant="docked"');
    expect(branch).toContain('dangerSlot={permanentLeaveSlot}');
    expect(branch).toContain('socialSlot={fiftyOneSocial}');
    expect(branch).toContain('timerSlot={timerEl}');
    expect((branch.match(/<RoomSocial/g) ?? []).length).toBe(1);
    expect(branch).not.toContain('renderSocial(');
    expect(onlineSrc).toContain('socialSlot={socialSlot}');
    expect(onlineSrc).toContain('timerSlot={timerSlot}');
  });

  it('local 51 has no online social controls at all', () => {
    expect(localSrc).not.toContain('menuSlot');
    expect(localSrc).not.toContain('timerSlot');
    expect(localSrc).not.toContain('RoomSocial');
    expect(localSrc).not.toContain('PermanentLeaveControl');
  });

  it('RoomSocial stays game-agnostic (no Fifty-One or Poker import)', () => {
    // Comments are stripped first, as in the sibling suites: a doc comment recording WHICH
    // game measured WHAT (Stage 38.0.13 pins the per-game RED geometry there) is evidence,
    // not a dependency. An import, a type or a runtime branch on a game still fails.
    const code = socialSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(socialSrc).not.toMatch(/import[^;]*(poker|fiftyOne|fifty-one)/i);
    expect(code).not.toMatch(/fifty-one|fiftyone/i);
  });

  it('(38.0.14) every game hands the SAME node to a generic in-flow slot', () => {
    // Four games build it through `renderSocial(true, …)`; 51 and Poker build their own
    // RoomSocial (they own extra slots). None of them renders it as a sibling overlay.
    expect((roomSrc.match(/renderSocial\(true/g) ?? []).length).toBe(4);
    expect((roomSrc.match(/socialSlot=\{renderSocial\(true/g) ?? []).length).toBe(4);
    expect(roomSrc).not.toContain('variant="docked"');
    expect(roomSrc).not.toContain('variant="sheet"');
    const poker = roomSrc.slice(roomSrc.indexOf("if (net.room?.gameType === 'poker') {"));
    expect(poker).toContain('socialSlot={social}');
    expect(poker).not.toContain('dangerSlot');
  });

  it('the 51 screen never imports RoomSocial itself (generic slots only)', () => {
    expect(screenSrc).not.toContain('RoomSocial');
    expect(screenSrc).toMatch(/socialSlot\?: ReactNode/);
  });
});
