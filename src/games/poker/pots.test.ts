import { describe, expect, it } from 'vitest';
import { computeSidePots, distributeChips, oddChipOrder } from './pots';

describe('poker side pots (§8)', () => {
  it('a single called pot has all non-folded contributors eligible', () => {
    const pots = computeSidePots([100, 100, 100], [false, false, false]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligibleSeats.sort()).toEqual([0, 1, 2]);
    expect(pots[0].returned).toBe(false);
  });

  it('folded contributors leave their chips in the pot but are not eligible', () => {
    const pots = computeSidePots([100, 100, 100], [false, true, false]);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligibleSeats.sort()).toEqual([0, 2]); // seat 1 folded → dead money
  });

  it('builds a main pot + side pot for a short all-in', () => {
    // seat 0 all-in 50, seats 1 & 2 put in 200 each.
    const pots = computeSidePots([50, 200, 200], [false, false, false]);
    expect(pots).toHaveLength(2);
    // main pot: 50 from each of 3 = 150, all eligible
    expect(pots[0].amount).toBe(150);
    expect(pots[0].eligibleSeats.sort()).toEqual([0, 1, 2]);
    // side pot: 150 each from seats 1 & 2 = 300, only they eligible
    expect(pots[1].amount).toBe(300);
    expect(pots[1].eligibleSeats.sort()).toEqual([1, 2]);
  });

  it('returns an uncalled top layer to its sole contributor', () => {
    // seat 0 bet 200, seat 1 could only call 120 (all-in), seat 2 folded after 0.
    const pots = computeSidePots([200, 120, 0], [false, false, true]);
    // level 120: contributors 0 & 1 → 240 contested (seat1 not folded, seat0 not folded)
    // level 200: only seat 0 → 80 returned
    const returned = pots.find((p) => p.returned);
    expect(returned).toBeTruthy();
    expect(returned!.amount).toBe(80);
    expect(returned!.winners).toEqual([0]);
    const contested = pots.find((p) => !p.returned)!;
    expect(contested.amount).toBe(240);
    expect(contested.eligibleSeats.sort()).toEqual([0, 1]);
  });
});

describe('poker chip distribution (§10)', () => {
  it('splits an even pot equally', () => {
    const shares = distributeChips(300, [0, 2], oddChipOrder(3, 0));
    expect(shares[0]).toBe(150);
    expect(shares[2]).toBe(150);
  });

  it('awards the odd chip to the first eligible winner clockwise from the button', () => {
    // pot 101, split between seats 1 & 3, button = 0 → order 1,2,3,0 → seat 1 first.
    const shares = distributeChips(101, [1, 3], oddChipOrder(4, 0));
    expect(shares[1]).toBe(51);
    expect(shares[3]).toBe(50);
  });

  it('distributes multiple odd chips one at a time clockwise', () => {
    // pot 302 split three ways among seats 0,1,2; button 3 → order 0,1,2,3.
    const shares = distributeChips(302, [0, 1, 2], oddChipOrder(4, 3));
    expect(shares[0]).toBe(101);
    expect(shares[1]).toBe(101);
    expect(shares[2]).toBe(100);
  });
});
