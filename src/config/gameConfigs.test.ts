import { describe, it, expect } from 'vitest';
import { getConfig } from './gameConfigs';
import { ALL_MODES } from './gameModes';

describe('getConfig', () => {
  it('3-player: 32-card deck, 10 cards each, 2-card kitty, 10 tricks', () => {
    const c = getConfig(3);
    expect(c).toMatchObject({ playerCount: 3, deckSize: 32, cardsPerPlayer: 10, kittySize: 2, tricksPerRound: 10 });
  });

  it('4-player: 52-card deck, 13 cards each, no kitty, 13 tricks', () => {
    const c = getConfig(4);
    expect(c).toMatchObject({ playerCount: 4, deckSize: 52, cardsPerPlayer: 13, kittySize: 0, tricksPerRound: 13 });
  });

  it('deck is fully dealt: cardsPerPlayer × playerCount + kitty === deckSize', () => {
    for (const n of [3, 4] as const) {
      const c = getConfig(n);
      expect(c.cardsPerPlayer * c.playerCount + c.kittySize).toBe(c.deckSize);
    }
  });

  it('tricksPerRound equals cardsPerPlayer (every hand card is played)', () => {
    expect(getConfig(3).tricksPerRound).toBe(getConfig(3).cardsPerPlayer);
    expect(getConfig(4).tricksPerRound).toBe(getConfig(4).cardsPerPlayer);
  });

  it('carries the full 7-mode list', () => {
    expect(getConfig(3).modes).toBe(ALL_MODES);
    expect(getConfig(3).modes).toHaveLength(7);
  });

  it('passes through modeSelectionType (default fixed)', () => {
    expect(getConfig(3).modeSelectionType).toBe('fixed');
    expect(getConfig(4, 'dealer_choice').modeSelectionType).toBe('dealer_choice');
  });

  it('uses per-player-count scoring (penalties scale with deck size)', () => {
    expect(getConfig(3).scoring.kingOfHearts).toBe(-40);
    expect(getConfig(4).scoring.kingOfHearts).toBe(-52);
    expect(getConfig(3).scoring.trumpRewardPerTrick).toBe(8);
    expect(getConfig(4).scoring.trumpRewardPerTrick).toBe(4);
  });
});
