// ---------------------------------------------------------------------------
// Pure bet/raise amount logic (Stage 38.0.2, §14). The slider, the Min/½/Pot/All-in
// presets and the manual numeric input all drive ONE amount through these helpers,
// so the three controls can never disagree.
//
// The client NEVER relaxes a rule: the amount is only ever clamped into the legal
// [raiseMin, maxTo] window that `legalActions()` derived, and an unusable draft
// (blank, NaN, ±Infinity, decimal, out of safe-integer range) is REFUSED — it falls
// back to the last valid amount instead of dispatching something illegal. The
// reducer and the server re-validate everything regardless.
// ---------------------------------------------------------------------------

/** The legal wager window for this decision: `min` = raiseMin/minBet, `max` = maxTo (all-in). */
export interface BetRange {
  min: number;
  max: number;
}

/**
 * Clamp into the legal window. A degenerate window (`max <= min`, i.e. the stack
 * cannot cover a full min-raise) collapses to `max` — the only legal amount, all-in.
 */
export function clampAmount(value: number, range: BetRange): number {
  const { min, max } = range;
  if (!Number.isFinite(value)) return max <= min ? max : min;
  if (max <= min) return max;
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse raw text from the numeric input. Returns null for anything that is not a
 * usable chip amount — blank/whitespace (a legitimate MID-EDIT state), NaN, ±Infinity,
 * a decimal, or a value outside the safe-integer range. Chips are whole units, so a
 * decimal is rejected rather than silently rounded.
 */
export function parseAmountInput(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/**
 * Commit a draft on blur / Enter / submit: a parseable amount is clamped into the
 * legal window; an unusable draft keeps `current` (also re-clamped), so committing
 * garbage can never produce an illegal action.
 */
export function commitAmount(raw: string, current: number, range: BetRange): number {
  const parsed = parseAmountInput(raw);
  return clampAmount(parsed ?? current, range);
}

/**
 * Re-align a held amount when the legal range changes (a new street, a new actor,
 * a short stack). Always returns a value inside the new window.
 */
export function syncAmountToRange(current: number, range: BetRange): number {
  return clampAmount(current, range);
}

/**
 * Which action a committed amount maps to. Reaching `maxTo` is ALL_IN (the existing
 * rule — an all-in is never sent as a BET/RAISE of the same size); otherwise it is a
 * BET when there is nothing to raise yet, else a RAISE.
 */
export function wagerKindFor(amount: number, range: BetRange, canBet: boolean): 'ALL_IN' | 'BET' | 'RAISE' {
  if (amount >= range.max) return 'ALL_IN';
  return canBet ? 'BET' : 'RAISE';
}
