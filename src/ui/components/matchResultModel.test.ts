import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import MatchResult from './MatchResult';
import { competitionPlaces, playerAvatar, splitPodium, type ResultSeat } from './matchResultModel';

// Stage 42.1 — the shared end screen: places, the podium split, the layouts.

const seat = (key: string, place: number, extra: Partial<ResultSeat> = {}): ResultSeat => ({ key, name: key, avatar: '🦊', place, ...extra });

describe('competitionPlaces', () => {
  it('ties share a place and the next place skips ("1, 1, 3")', () => {
    expect(competitionPlaces([120, 40, 120, -5], (a, b) => b - a)).toEqual([1, 3, 1, 4]);
    expect(competitionPlaces([3, 1, 2], (a, b) => a - b)).toEqual([3, 1, 2]); // lower is better
  });
});

describe('splitPodium', () => {
  it('a single winner stands in the middle of a 2 · 1 · 3 podium; the rest are listed', () => {
    const { podium, rest } = splitPodium([seat('d', 4), seat('b', 2), seat('a', 1), seat('c', 3)]);
    expect(podium.map((s) => s.key)).toEqual(['b', 'a', 'c']);
    expect(rest.map((s) => s.key)).toEqual(['d']);
    expect(splitPodium([seat('b', 2), seat('a', 1)]).podium.map((s) => s.key)).toEqual(['b', 'a']);
  });

  it('a winner group is not a podium', () => {
    const { podium, rest } = splitPodium([seat('a', 1), seat('b', 1), seat('c', 3)]);
    expect(podium.map((s) => s.key)).toEqual(['a', 'b']);
    expect(rest.map((s) => s.key)).toEqual(['c']);
  });
});

describe('playerAvatar', () => {
  it('bots get 🤖, a whitelisted emoji is kept, anything else gets a stable default', () => {
    expect(playerAvatar({ name: 'Kai', type: 'ai', avatar: '🦊' })).toBe('🤖');
    expect(playerAvatar({ name: 'Ola', avatar: '🦊' })).toBe('🦊');
    expect(playerAvatar({ name: 'Ola', avatar: '<b>' })).toBe(playerAvatar({ name: 'Ola' }));
  });
});

describe('MatchResult layouts', () => {
  const render = (props: Partial<Parameters<typeof MatchResult>[0]>) => renderToStaticMarkup(createElement(MatchResult, {
    game: 'king', outcome: 'win', title: 'T', actions: null, ...props,
  }));

  it('one winner → podium with a single "winner" ribbon and the rest listed', () => {
    const html = render({ seats: [seat('a', 1), seat('b', 2), seat('c', 3), seat('d', 4)] });
    expect(html).toContain('result__deal--podium');
    expect(html.match(/result-card__ribbon/g)).toHaveLength(1);
    expect(html.match(/<li [^>]*class="result-row /g)).toHaveLength(1);
  });

  it('a winner group of ≤4 deals everyone as cards, the loser on a red face, no ribbons', () => {
    const html = render({ game: 'durak', outcome: 'fool', seats: [seat('a', 1), seat('b', 1), seat('c', 3, { tone: 'lose', note: 'Fool' })] });
    expect(html).toContain('result__deal--row');
    expect(html).toContain('result-card--lose');
    expect(html).not.toContain('result-card__ribbon');
    expect(html).not.toContain('result-row');
  });

  it('teams render two team cards', () => {
    const html = render({ teams: [
      { key: 'A', label: 'A', members: [{ name: 'x', avatar: '🦊' }, { name: 'y', avatar: '🐼' }], value: '41', won: true },
      { key: 'B', label: 'B', members: [{ name: 'z', avatar: '🐸' }, { name: 'w', avatar: '🦁' }], value: '30', won: false },
    ] });
    expect(html.match(/result-card--team/g)).toHaveLength(2);
    expect(html).toContain('winner-celebration--teamWin');
  });
});
