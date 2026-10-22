// The card-back store (Stage 13.0) is the single client source of truth for the
// selected back. Exercised here without a DOM (node env): default, setter,
// legacy-value normalisation, and the Stage 42.2 'auto' choice that follows the theme.
import { describe, it, expect, afterEach } from 'vitest';
import { getCardBackStyle, getCardBackChoice, setCardBackStyle } from './cardBackStore';
import { setAppTheme } from './appThemeStore';

afterEach(() => { setCardBackStyle('auto'); setAppTheme('midnight'); }); // reset the singletons

describe('cardBackStore', () => {
  it('defaults to auto → the sapphire back on the Midnight theme (no localStorage in node)', () => {
    expect(getCardBackChoice()).toBe('auto');
    expect(getCardBackStyle()).toBe('blue');
  });

  it('auto follows the theme: Classic draws green, Midnight sapphire', () => {
    setAppTheme('classic');
    expect(getCardBackStyle()).toBe('green');
    setAppTheme('midnight');
    expect(getCardBackStyle()).toBe('blue');
  });

  it('a pinned back ignores the theme', () => {
    setCardBackStyle('green');
    expect(getCardBackStyle()).toBe('green');
    setAppTheme('classic');
    setCardBackStyle('red');
    setAppTheme('midnight');
    expect(getCardBackChoice()).toBe('red');
    expect(getCardBackStyle()).toBe('red');
  });

  it('normalises legacy/unknown values to auto', () => {
    setCardBackStyle('red');
    setCardBackStyle('classic');       // the DB default = "never chose"
    expect(getCardBackChoice()).toBe('auto');
    setCardBackStyle('red');
    setCardBackStyle('holographic');   // off the whitelist → auto
    expect(getCardBackChoice()).toBe('auto');
    setCardBackStyle(null);
    expect(getCardBackStyle()).toBe('blue');
  });
});
