// Stage 27.4 — clockwise turn-order + table-clarity audit.
//
// The owner wants play to READ clockwise on screen in every game. Each game screen lays its
// seat slots out in the CLOCKWISE array order ['bottom','left','top','right'] (3-seat drops
// 'top'), so the invariant we assert is simple and game-agnostic:
//
//     the seat that plays RIGHT AFTER the viewer must land in the 'left' slot
//     (the first clockwise step from the bottom).
//
// We take the ENGINE's real next-seat helper for each game and run it through that game's
// screen slot-mapping (replicated here, and source-guarded below so the copy can't drift).
// King/Durak/Deberc advance by +1 index; Preferans uses nextSeat (+1); Tarneeb's engine order
// is counter-clockwise BY INDEX (0→3→2→1) yet must still read clockwise — that only works
// because its UI mapping mirrors (viewerSeat−seat), which this test pins down.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextSeatCounterClockwise } from '../games/tarneeb/rules';
import { nextSeat as preferansNextSeat } from '../games/preferans/deck';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SLOTS_4 = ['bottom', 'left', 'top', 'right'] as const;
const SLOTS_3 = ['bottom', 'left', 'right'] as const;

// Slot mappings, mirroring each screen's seatPosition()/relPos() (guarded below).
const forward4 = (seat: number, viewer: number) => SLOTS_4[(seat - viewer + 4) % 4]; // King/Durak/Deberc
const forward3 = (seat: number, viewer: number) => SLOTS_3[(seat - viewer + 3) % 3]; // Preferans
const mirror4 = (seat: number, viewer: number) => SLOTS_4[(viewer - seat + 4) % 4];  // Tarneeb

describe('clockwise turn order — the engine successor lands in the LEFT slot (Stage 27.4)', () => {
  it('King / Durak / Deberc advance +1 and read clockwise from every seat', () => {
    for (let v = 0; v < 4; v++) {
      expect(forward4((v + 1) % 4, v)).toBe('left'); // successor at bottom→LEFT
      expect(forward4((v + 2) % 4, v)).toBe('top');
      expect(forward4((v + 3) % 4, v)).toBe('right');
    }
  });

  it('Preferans (3-seat, +1) reads clockwise from every seat', () => {
    for (let v = 0; v < 3; v++) {
      expect(forward3(preferansNextSeat(v), v)).toBe('left');
      expect(forward3(preferansNextSeat(preferansNextSeat(v)), v)).toBe('right');
    }
  });

  it('Tarneeb reads clockwise even though its engine order is counter-clockwise by index', () => {
    for (let v = 0; v < 4; v++) {
      // Engine successor is nextSeatCounterClockwise (seat−1 by index)…
      expect(nextSeatCounterClockwise(v)).toBe((v + 3) % 4);
      // …but the mirrored UI mapping still puts that successor at the LEFT (clockwise),
      // and keeps the partner (offset 2) opposite at the TOP.
      expect(mirror4(nextSeatCounterClockwise(v), v)).toBe('left');
      expect(mirror4((v + 2) % 4, v)).toBe('top');
    }
  });
});

describe('screen seat-mappings match the audited formulas (source guards)', () => {
  it('Tarneeb mirrors (viewerSeat − seat) so the CCW-by-index order reads clockwise', () => {
    const src = read('src/ui/tarneeb/TarneebGameScreen.tsx');
    expect(src).toMatch(/POSITIONS\[\(viewerSeat - seat \+ 4\) % 4\]/);
    expect(src).toContain("['bottom', 'left', 'top', 'right']");
  });
  it('Preferans uses (seat − viewerSeat) and is documented as clockwise', () => {
    const src = read('src/ui/preferans/PreferansGameScreen.tsx');
    expect(src).toMatch(/POSITIONS\[\(seat - viewerSeat \+ 3\) % 3\]/);
    expect(src).toMatch(/reads CLOCKWISE/);
    expect(src).not.toMatch(/flows counter-clockwise/);
  });
  it('King (TablePlayers) and Deberc lay opponents +1→left (clockwise)', () => {
    expect(read('src/ui/components/TablePlayers.tsx')).toMatch(/\(seatIndex - viewerSeat \+ count\) % count/);
    expect(read('src/ui/deberc/DebercGameScreen.tsx')).toMatch(/\(meSeat \+ 1 \+ k\) % n/);
  });
});

describe('table clarity — lead / winner / pairs present in every trick renderer (Stage 27.4)', () => {
  it('King current trick flags the lead card and the winning card', () => {
    const src = read('src/ui/components/TablePlayers.tsx');
    expect(src).toMatch(/lead=\{i === 0\}/);           // led card badge
    expect(src).toMatch(/highlight=\{isWinning\}/);     // winner card pulse
    expect(src).toMatch(/trick-slot--winning/);
  });
  it('Tarneeb / Preferans / Deberc current trick flags the lead card', () => {
    for (const f of ['src/ui/tarneeb/TarneebGameScreen.tsx', 'src/ui/preferans/PreferansGameScreen.tsx']) {
      expect(read(f), f).toMatch(/lead=\{lead\}/);
    }
    expect(read('src/ui/deberc/DebercGameScreen.tsx')).toMatch(/lead=\{i === 0\}/);
  });
  it('Durak groups each attack with its defending card (beaten/unbeaten)', () => {
    const src = read('src/ui/durak/DurakGameScreen.tsx');
    expect(src).toContain('durak-pair');
    expect(src).toContain('durak-pair__def');                       // defense card nested under its attack
    expect(src).toMatch(/durak-pair--beaten|durak-pair--unbeaten/); // covered vs still-open pair
    expect(src).toMatch(/highlight=\{pair\.defense === null\}/);     // unbeaten attack stands out
  });
});

describe('reveal delay is a readable ~2s everywhere (Stage 27.4)', () => {
  const cases: [string, RegExp][] = [
    ['src/net/serverTiming.ts', /DEFAULT_TRICK_ADVANCE_MS = 2000/],
    ['src/ui/LocalGame.tsx', /TRICK_VIEW_MS = 2000/],            // King
    ['src/ui/durak/DurakGameScreen.tsx', /TABLE_REVIEW_MS = 2000/],
    ['src/ui/deberc/DebercLocalGame.tsx', /ADVANCE_MS = 2000/],
    ['src/ui/tarneeb/TarneebLocalGame.tsx', /TRICK_REVIEW_MS = 2000/],
    ['src/ui/preferans/PreferansLocalGame.tsx', /TRICK_REVIEW_MS = 2000/],
    ['src/ui/components/useTrickReview.ts', /TRICK_REVIEW_MS = 2000/],
  ];
  for (const [file, re] of cases) {
    it(`${file} lingers 2000ms`, () => expect(read(file)).toMatch(re));
  }
});
