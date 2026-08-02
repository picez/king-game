import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clampAmount, commitAmount, parseAmountInput, syncAmountToRange, wagerKindFor, type BetRange,
} from './betAmount';

// Stage 38.0.2 item 3 — the manual numeric bet/raise field. The slider, the presets
// and the input all drive ONE amount through these helpers, so they cannot disagree;
// and no draft the user can type may ever produce an illegal action.

const R: BetRange = { min: 100, max: 5000 };

describe('parseAmountInput — strict finite safe-integer validation', () => {
  it('accepts a plain integer (with surrounding whitespace)', () => {
    expect(parseAmountInput('250')).toBe(250);
    expect(parseAmountInput('  250  ')).toBe(250);
    expect(parseAmountInput('0')).toBe(0);
    expect(parseAmountInput('-40')).toBe(-40); // parsed; the clamp is what makes it legal
  });

  it('REFUSES a blank draft (a legitimate mid-edit state, never an action)', () => {
    expect(parseAmountInput('')).toBe(null);
    expect(parseAmountInput('   ')).toBe(null);
  });

  it('REFUSES NaN / garbage / partial input', () => {
    for (const raw of ['abc', '1e', '--5', '+-2', 'NaN', '1,000', '1 000']) {
      expect(parseAmountInput(raw)).toBe(null);
    }
  });

  it('REFUSES ±Infinity and unsafe magnitudes', () => {
    expect(parseAmountInput('Infinity')).toBe(null);
    expect(parseAmountInput('-Infinity')).toBe(null);
    expect(parseAmountInput('9007199254740993')).toBe(null); // > MAX_SAFE_INTEGER
    expect(parseAmountInput('1e400')).toBe(null);
  });

  it('REFUSES a decimal — chips are whole units, never silently rounded', () => {
    expect(parseAmountInput('250.5')).toBe(null);
    expect(parseAmountInput('0.1')).toBe(null);
    expect(parseAmountInput('1e-3')).toBe(null);
  });

  it('accepts exponent/hex forms that ARE safe integers (Number semantics)', () => {
    expect(parseAmountInput('2e3')).toBe(2000);
  });
});

describe('clampAmount — never outside the legal window', () => {
  it('clamps below/above and passes an in-range value through', () => {
    expect(clampAmount(50, R)).toBe(100);
    expect(clampAmount(99999, R)).toBe(5000);
    expect(clampAmount(1234, R)).toBe(1234);
    expect(clampAmount(-1, R)).toBe(100);
  });

  it('a degenerate window (max <= min, short stack) collapses to max = all-in', () => {
    const short: BetRange = { min: 800, max: 400 };
    expect(clampAmount(800, short)).toBe(400);
    expect(clampAmount(10, short)).toBe(400);
    expect(clampAmount(Number.NaN, short)).toBe(400);
  });

  it('a non-finite value falls back inside the window', () => {
    expect(clampAmount(Number.NaN, R)).toBe(100);
    expect(clampAmount(Number.POSITIVE_INFINITY, R)).toBe(100);
  });
});

describe('commitAmount — blur / Enter / button', () => {
  it('commits a valid draft, clamped', () => {
    expect(commitAmount('1500', 100, R)).toBe(1500);
    expect(commitAmount('10', 100, R)).toBe(100);     // below min → min
    expect(commitAmount('99999', 100, R)).toBe(5000); // above max → max (all-in)
  });

  it('an unusable draft keeps the LAST valid amount — no illegal action is produced', () => {
    for (const raw of ['', '   ', 'abc', '250.5', 'Infinity']) {
      expect(commitAmount(raw, 1234, R)).toBe(1234);
    }
  });

  it('a stale fallback is itself re-clamped into the window', () => {
    expect(commitAmount('', 99999, R)).toBe(5000);
    expect(commitAmount('nope', 1, R)).toBe(100);
  });
});

describe('syncAmountToRange — the legal range changed under us', () => {
  it('re-clamps a held amount into the NEW window', () => {
    expect(syncAmountToRange(4000, { min: 100, max: 1000 })).toBe(1000); // stack shrank
    expect(syncAmountToRange(50, { min: 200, max: 9000 })).toBe(200);    // min-raise grew
    expect(syncAmountToRange(500, R)).toBe(500);                          // still legal → unchanged
  });

  it('an amount that is still legal is returned identically (no needless reset)', () => {
    const held = 2500;
    expect(syncAmountToRange(held, R)).toBe(held);
  });
});

describe('wagerKindFor — min/max and the ALL_IN rule', () => {
  it('reaching maxTo is ALL_IN (never a same-size BET/RAISE)', () => {
    expect(wagerKindFor(5000, R, true)).toBe('ALL_IN');
    expect(wagerKindFor(5000, R, false)).toBe('ALL_IN');
    expect(wagerKindFor(999999, R, false)).toBe('ALL_IN'); // already clamped in practice
  });

  it('below maxTo: BET when nothing to raise, else RAISE', () => {
    expect(wagerKindFor(100, R, true)).toBe('BET');
    expect(wagerKindFor(2500, R, false)).toBe('RAISE');
  });

  it('a degenerate window makes the only legal amount an all-in', () => {
    const short: BetRange = { min: 800, max: 400 };
    expect(wagerKindFor(clampAmount(800, short), short, false)).toBe('ALL_IN');
  });
});

describe('input ↔ slider ↔ presets stay in sync', () => {
  // The component holds ONE `amount`; the slider writes it directly, the presets write
  // a clamped preset, and the input writes it whenever the draft parses. Whatever path
  // is taken, the committed value is the same function of the draft + range.
  it('a preset, a slider move and a typed value converge on the same committed amount', () => {
    const viaPreset = clampAmount(R.min + 400, R);          // ½-pot style preset
    const viaSlider = clampAmount(500, R);                  // slider emits an int in range
    const viaInput = commitAmount('500', 100, R);           // typed
    expect(viaPreset).toBe(500);
    expect(viaSlider).toBe(500);
    expect(viaInput).toBe(500);
  });

  it('the all-in preset and a typed over-max value both commit to maxTo → ALL_IN', () => {
    const preset = clampAmount(R.max, R);
    const typed = commitAmount('123456789', 100, R);
    expect(preset).toBe(R.max);
    expect(typed).toBe(R.max);
    expect(wagerKindFor(typed, R, false)).toBe('ALL_IN');
  });
});

describe('PokerGameScreen wires the numeric field to the shared helpers', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/poker/PokerGameScreen.tsx'), 'utf8');

  it('renders a localized numeric input alongside the slider and presets', () => {
    expect(src).toContain('poker-amount-input');
    expect(src).toContain('type="number"');
    expect(src).toContain('inputMode="numeric"');
    expect(src).toContain("aria-label={t('poker.amount')}");
    expect(src).toContain('poker-slider');
    expect(src).toContain('poker-preset');
  });

  it('shows the allowed min–max and binds the field to the legal range', () => {
    expect(src).toContain('poker.amountRange');
    expect(src).toContain('min={range.min}');
    expect(src).toContain('max={range.max}');
  });

  it('Enter in the field runs the SAME send as the Bet/Raise button', () => {
    expect(src).toMatch(/if \(e\.key === 'Enter'\)[^}]*sendWager\(\)/);
    expect(src).toContain('onClick={sendWager}');
  });

  it('commits through the strict helpers on blur and on submit', () => {
    expect(src).toContain('commitAmount(draft, amount, range)');
    expect(src).toContain('onBlur=');
    expect(src).toContain('syncAmountToRange');
    expect(src).toContain('wagerKindFor');
  });
});
