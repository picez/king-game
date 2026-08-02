import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import FiftyOneGameScreen from './FiftyOneGameScreen';
import type { FiftyOneCard, FiftyOneMeld, FiftyOneState } from '../../games/fiftyOne/types';
import type { Rank, Suit } from '../../models/types';

// Stage 38.0.4 — the owner's phone showed a 4-card meld with its last card CUT OFF and
// the floating social cluster sitting ON TOP of the laid-out melds.
//
// The pairwise rectangle proof lives in `scripts/fiftyone-layout-qa.mjs` (a real browser,
// real getBoundingClientRect, with a `--legacy` switch that reproduces the RED). These
// tests pin the CONTRACT that makes that geometry possible, so a refactor cannot undo it.

const html = (el: ReactElement) => renderToStaticMarkup(el);
let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}`, joker: false, suit, rank });
const joker = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });

function meld(id: string, ownerSeat: number, cards: FiftyOneCard[], jokerAt?: number): FiftyOneMeld {
  return {
    id, ownerSeat, type: 'run', cards, value: 30,
    jokerRepresents: jokerAt == null ? {} : { [jokerAt]: { suit: 'hearts', rank: '7' } },
  } as FiftyOneMeld;
}

function state(players = 4): FiftyOneState {
  const set3 = [c('Q', 'hearts'), c('Q', 'clubs'), c('Q', 'diamonds')];
  const run4 = [c('6', 'spades'), c('7', 'spades'), c('8', 'spades'), c('9', 'spades')];
  const run7 = [c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts'), joker(), c('8', 'hearts'), c('9', 'hearts'), c('10', 'hearts')];
  const dup = [c('6', 'spades'), c('6', 'clubs'), c('6', 'diamonds'), c('6', 'hearts')];   // second deck
  const seat = (i: number) => Math.min(i, players - 1);
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
    publicMelds: [
      meld('m1', seat(1), set3), meld('m2', seat(1), run4),
      meld('m3', seat(2), run7, 3), meld('m4', seat(3), dup),
    ],
    scoresBySeat: Array.from({ length: players }, () => 30),
    eliminatedSeats: Array.from({ length: players }, () => false),
    roundNumber: 3, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
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
});

describe('the meld stylesheet cannot re-create the clipping', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/fiftyone.css'), 'utf8');

  it('the artificial 18rem cap is gone', () => {
    expect(css).not.toContain('max-width: min(100%, 18rem)');
    expect(css).toMatch(/\.fiftyone-meld \{[^}]*flex: 1 1 16rem/);
  });

  it('the card row WRAPS instead of scrolling inside itself', () => {
    const row = css.slice(css.indexOf('.fiftyone-meld__cards {'), css.indexOf('.fiftyone-meld__cards >'));
    expect(row).toContain('flex-wrap: wrap');
    expect(row).not.toContain('overflow-x: auto');
    expect(row).not.toContain('nowrap');
  });

  it('card width is responsive and the face aspect is preserved', () => {
    expect(css).toMatch(/--f51-meld-card-w:\s*clamp\(/);
    expect(css).toMatch(/--f51-meld-card-h:\s*calc\(var\(--f51-meld-card-w\)/);
  });

  it('no negative margin, no transform and no overflow:hidden hides the problem', () => {
    const block = css.slice(css.indexOf('.fiftyone-melds {'), css.indexOf('.fiftyone-selbuilder'));
    expect(block).not.toMatch(/margin:\s*-/);
    expect(block).not.toMatch(/margin-(left|right|inline-start|inline-end):\s*-/);
    expect(block).not.toMatch(/overflow:\s*hidden/);
    expect(block).toMatch(/transform: none/);          // the existing anti-overlap guard
  });

  it('cards keep a positive gap and meld controls stay a real tap target', () => {
    expect(css).toMatch(/--f51-meld-gap:\s*0\.4rem/);
    expect(css).toMatch(/\.fiftyone-meld__ctrls button \{[^}]*min-height: 44px/);
  });

  it('the run order is never mirrored under RTL', () => {
    const row = css.slice(css.indexOf('.fiftyone-meld__cards {'), css.indexOf('.fiftyone-meld__cards >'));
    expect(row).toContain('direction: ltr');
  });
});

describe('the social cluster is docked, in flow, and only online', () => {
  const screenSrc = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneGameScreen.tsx'), 'utf8');
  const onlineSrc = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneOnlineGame.tsx'), 'utf8');
  const localSrc = readFileSync(join(process.cwd(), 'src/ui/fiftyOne/FiftyOneLocalGame.tsx'), 'utf8');
  const roomSrc = readFileSync(join(process.cwd(), 'src/ui/online/OnlineGame.tsx'), 'utf8');
  const socialSrc = readFileSync(join(process.cwd(), 'src/ui/online/RoomSocial.tsx'), 'utf8');

  it('the slot renders between the melds and the prompt', () => {
    const out = html(screen({ socialSlot: createElement('div', { className: 'probe-social' }) }));
    const melds = out.indexOf('fiftyone-melds');
    const dock = out.indexOf('fiftyone-social-dock');
    const prompt = out.indexOf('fiftyone-prompt');
    expect(dock).toBeGreaterThan(melds);
    expect(prompt).toBeGreaterThan(dock);
    expect(out).toContain('probe-social');
  });

  it('without a slot nothing extra is rendered (local play is untouched)', () => {
    expect(html(screen())).not.toContain('fiftyone-social-dock');
  });

  it('online 51 mounts the DOCKED generic RoomSocial exactly once', () => {
    // The branch runs from its own guard to the start of the poker branch that follows
    // it (`gameType === 'poker'` also appears earlier, in the poker log-length helper).
    const from = roomSrc.indexOf("if (net.room?.gameType === 'fifty-one')");
    const to = roomSrc.indexOf("if (net.room?.gameType === 'poker')");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const branch = roomSrc.slice(from, to);
    expect(branch).toContain('variant="docked"');
    expect(branch).toContain('socialSlot={fiftyOneSocial}');
    expect((branch.match(/<RoomSocial/g) ?? []).length).toBe(1);
    // The floating cluster is no longer mounted for 51.
    expect(branch).not.toContain('renderSocial(');
    expect(onlineSrc).toContain('socialSlot={socialSlot}');
  });

  it('local 51 never passes a social slot', () => {
    expect(localSrc).not.toContain('socialSlot');
    expect(localSrc).not.toContain('RoomSocial');
  });

  it('RoomSocial stays game-agnostic (no Fifty-One or Poker import)', () => {
    expect(socialSrc).not.toMatch(/import[^;]*(poker|fiftyOne|fifty-one)/i);
  });

  it('the other games keep the floating cluster (five renderSocial mounts)', () => {
    // durak, deberc, tarneeb, preferans keep the floating cluster; poker and 51 dock.
    expect((roomSrc.match(/renderSocial\(true/g) ?? []).length).toBe(4);
  });
});
