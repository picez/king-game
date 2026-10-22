import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import DurakFinished from './DurakFinished';
import { groupIndex } from '../components/matchResultModel';
import type { DurakPlayer, DurakState } from '../../games/durak/types';

// Stage 42.4 — the Durak end screen ranks players by the order they went out.

const P = (seat: number): DurakPlayer => ({ id: `player-${seat}`, name: `Name${seat}`, seatIndex: seat, type: 'human', hand: [] });

function finished(over: Partial<DurakState>): DurakState {
  return {
    gameType: 'durak', variant: 'simple', players: [P(0), P(1), P(2), P(3)],
    drawPile: [], trumpSuit: 'spades', trumpCard: { rank: '6', suit: 'spades', value: 6 },
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
    table: [], discardPile: [], status: 'finished', boutLimit: 6,
    foolId: 'player-1', winnerIds: ['player-0', 'player-2', 'player-3'], isDraw: false, ...over,
  };
}
const render = (state: DurakState) => renderToStaticMarkup(createElement(DurakFinished, {
  state, humanId: 'player-0', onPlayAgain: () => {}, onExit: () => {},
}));

describe('groupIndex', () => {
  it('finds the group holding a key, -1 when absent or without groups', () => {
    expect(groupIndex([['a'], ['b', 'c']], 'c')).toBe(1);
    expect(groupIndex([['a']], 'z')).toBe(-1);
    expect(groupIndex(undefined, 'a')).toBe(-1);
  });
});

describe('Durak end screen with an exit order', () => {
  it('the first out stands on the podium; players out together share second', () => {
    const html = render(finished({ exitOrder: [['player-2'], ['player-0', 'player-3']] }));
    expect(html).toContain('result__deal--podium');
    // Podium order is 2 · 1 · 3 → Name0 (2nd), Name2 (1st), Name3 (2nd, tie).
    const at = (n: string) => html.indexOf(`>${n}<`);
    expect(at('Name0')).toBeGreaterThan(-1);
    expect(at('Name0')).toBeLessThan(at('Name2'));
    expect(at('Name2')).toBeLessThan(at('Name3'));
    expect(html.match(/result-card__ribbon/g)).toHaveLength(1);
  });

  it('a game saved before the exit order keeps the survivors-share-first layout', () => {
    const html = render(finished({}));
    expect(html).toContain('result__deal--row');
    expect(html).not.toContain('result-card__ribbon');
  });
});
