import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import DurakFinished from './DurakFinished';
import type { DurakPlayer, DurakState } from '../../games/durak/types';
import { EN as en } from '../../i18n/dictionaries/en';
import { UK as uk } from '../../i18n/dictionaries/uk';
import { DE as de } from '../../i18n/dictionaries/de';
import { AR as ar } from '../../i18n/dictionaries/ar';

// Stage 41.7 — «Погоны»: a cosmetic end-screen line when the fool took a finishing attack of sixes.

const P = (seat: number): DurakPlayer => ({ id: `player-${seat}`, name: `Name${seat}`, seatIndex: seat, type: 'human', hand: [] });
const six = (suit: 'spades' | 'hearts') => ({ rank: '6' as const, suit, value: 6 });

function finished(over: Partial<DurakState>): DurakState {
  return {
    gameType: 'durak', variant: 'simple', players: [P(0), P(1), P(2)],
    drawPile: [], trumpSuit: 'spades', trumpCard: { rank: '6', suit: 'spades', value: 6 },
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
    table: [], discardPile: [], status: 'finished', boutLimit: 6,
    foolId: 'player-1', winnerIds: ['player-0', 'player-2'], isDraw: false, ...over,
  };
}
const render = (state: DurakState) => renderToStaticMarkup(createElement(DurakFinished, {
  state, humanId: 'player-0', onPlayAgain: () => {}, onExit: () => {},
}));

describe('epaulettes line', () => {
  it('names the attacker and the fool after an all-sixes finishing attack', () => {
    const html = render(finished({ lastBout: [{ attack: six('spades'), beat: null }, { attack: six('hearts'), beat: null }] }));
    expect(html).toContain('durak-finished__epaulettes');
    expect(html).toContain('Name0');
    expect(html).not.toContain('{attacker}');
    expect(html).not.toContain('{fool}');
  });

  it('is absent for a normal finish and for a draw', () => {
    const seven = { rank: '7' as const, suit: 'hearts' as const, value: 7 };
    expect(render(finished({ lastBout: [{ attack: six('spades'), beat: null }, { attack: seven, beat: null }] }))).not.toContain('epaulettes');
    expect(render(finished({ isDraw: true, foolId: null, lastBout: [{ attack: six('spades'), beat: null }] }))).not.toContain('epaulettes');
  });

  it('is translated in every language with both placeholders', () => {
    for (const dict of [en, uk, de, ar] as Record<string, string>[]) {
      expect(dict['durak.epaulettes']).toBeTruthy();
      expect(dict['durak.epaulettesDesc']).toContain('{attacker}');
      expect(dict['durak.epaulettesDesc']).toContain('{fool}');
    }
  });
});
