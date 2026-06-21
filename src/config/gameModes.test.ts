import { describe, it, expect } from 'vitest';
import { ALL_MODES, DEALER_MODE_ORDER, DEALER_MODE_COUNTS } from './gameModes';
import { TRACKER_COLUMNS } from '../core/scoreTracker';

/**
 * Display/turn order: No Jacks must always come before No Queens (see the
 * post-playtest fix #3). Scoring is unaffected — only the ordering of the
 * single source of truth (ALL_MODES) and the dealer's fixed sequence.
 */
describe('mode order — No Jacks before No Queens', () => {
  it('ALL_MODES lists no_jacks before no_queens', () => {
    const modes = ALL_MODES.map((m) => m.id);
    expect(modes.indexOf('no_jacks')).toBeLessThan(modes.indexOf('no_queens'));
  });

  it('DEALER_MODE_ORDER plays no_jacks before no_queens', () => {
    expect(DEALER_MODE_ORDER.indexOf('no_jacks')).toBeLessThan(
      DEALER_MODE_ORDER.indexOf('no_queens'),
    );
  });

  it('score-tracker columns show Jacks before Queens', () => {
    const cols = TRACKER_COLUMNS.map((c) => c.id);
    expect(cols.indexOf('no_jacks')).toBeLessThan(cols.indexOf('no_queens'));
  });

  it('scoring counts are unchanged (jacks and queens both played once)', () => {
    expect(DEALER_MODE_COUNTS.no_jacks).toBe(1);
    expect(DEALER_MODE_COUNTS.no_queens).toBe(1);
  });

  // The mode-selection grid iterates ALL_MODES directly, so its order is
  // guaranteed by the ALL_MODES assertion above (single source of truth).
});
