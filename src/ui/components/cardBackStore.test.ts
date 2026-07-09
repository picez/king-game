// The card-back store (Stage 13.0) is the single client source of truth for the
// selected back style. Exercised here without a DOM (node env): default, setter,
// legacy-value normalisation, and idempotence.
import { describe, it, expect, afterEach } from 'vitest';
import { getCardBackStyle, setCardBackStyle } from './cardBackStore';

afterEach(() => setCardBackStyle('green')); // reset the singleton between cases

describe('cardBackStore', () => {
  it('defaults to green (no localStorage in node)', () => {
    expect(getCardBackStyle()).toBe('green');
  });

  it('setCardBackStyle switches to red and back to green', () => {
    setCardBackStyle('red');
    expect(getCardBackStyle()).toBe('red');
    setCardBackStyle('green');
    expect(getCardBackStyle()).toBe('green');
  });

  it('normalises legacy/unknown values to green', () => {
    setCardBackStyle('classic');       // legacy DB value for the green back
    expect(getCardBackStyle()).toBe('green');
    setCardBackStyle('red');
    setCardBackStyle('holographic');   // off the whitelist → green
    expect(getCardBackStyle()).toBe('green');
    setCardBackStyle(null);
    expect(getCardBackStyle()).toBe('green');
  });
});
