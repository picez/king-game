import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../../core/rng';
import { dealDurak } from './deck';
import { durakReducer } from './engine';
import { durakRedactStateFor } from './redact';

// Stage 41.6 — Durak for 6: the whole deck is dealt and the last card shows the trump.

describe('six-player deal', () => {
  it('deals all 36 cards, leaves no draw pile, and the last card dealt is the trump', () => {
    for (const seed of [1, 2, 3, 99]) {
      const { hands, drawPile, trumpCard, trumpSuit } = dealDurak(6, makeRng(seed));
      expect(hands.map((h) => h.length)).toEqual([6, 6, 6, 6, 6, 6]);
      expect(drawPile).toEqual([]);
      expect(hands[5][5]).toEqual(trumpCard); // still in its player's hand
      expect(trumpSuit).toBe(trumpCard.suit);
      expect(new Set(hands.flat().map((c) => `${c.rank}${c.suit}`)).size).toBe(36);
    }
  });

  it('five players still leave a 6-card pile with the trump at its bottom', () => {
    const { drawPile, trumpCard } = dealDurak(5, makeRng(4));
    expect(drawPile).toHaveLength(6);
    expect(drawPile[drawPile.length - 1]).toEqual(trumpCard);
  });

  it('starts a 6-player game (and still refuses 7), the trump card public to every seat', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const s = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant: 'simple' }, { rng: makeRng(5) })!;
    expect(s.players).toHaveLength(6);
    expect(s.drawPile).toHaveLength(0);
    expect(durakReducer(null, { type: 'START_DURAK', playerNames: [...names, 'G'], variant: 'simple' }, { rng: makeRng(5) })).toBeNull();
    const view = durakRedactStateFor(s, 0);
    expect(view.trumpCard).toEqual(s.trumpCard);
  });
});

describe('table layout', () => {
  it('names a seat slot for every opponent at every supported size', () => {
    const src = readFileSync(join(process.cwd(), 'src/ui/durak/DurakGameScreen.tsx'), 'utf8');
    const block = src.slice(src.indexOf('const SEAT_LAYOUT'), src.indexOf('};', src.indexOf('const SEAT_LAYOUT')));
    for (let n = 2; n <= 6; n++) {
      const line = block.split(/\r?\n/).find((l) => l.trim().startsWith(`${n}: [`));
      expect(line, `${n}p layout`).toBeDefined();
      expect(line!.split(',').filter((x) => x.includes("'")).length).toBe(n);
    }
    const css = readFileSync(join(process.cwd(), 'src/styles/durak.css'), 'utf8');
    for (const slot of ['top-left', 'top-right']) expect(css).toContain(`.durak-seat--${slot}`);
  });
});
