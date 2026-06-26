import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Stage 9.11 source guards: Durak seats sit around the felt by RELATIVE play order
// (not re-sorted), the deck/trump moved onto the centre of the felt, and King's
// circular seating is untouched.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Durak circular seating (Stage 9.11)', () => {
  const durak = read('./durak/DurakGameScreen.tsx');

  it('maps relative seat index → bottom/left/top/right per player count', () => {
    expect(durak).toContain("2: ['bottom', 'top']");
    expect(durak).toContain("3: ['bottom', 'left', 'right']");
    expect(durak).toContain("4: ['bottom', 'left', 'top', 'right']");
  });
  it('seats opponents by their relative order (does NOT re-sort)', () => {
    // opponents are already ordered clockwise from me; position = layout[k + 1].
    expect(durak).toContain('(meSeat + 1 + k) % state.players.length');
    expect(durak).toContain('SEAT_LAYOUT[state.players.length] ?? SEAT_LAYOUT[4])[k + 1]');
    expect(durak).toContain('durak-seat durak-seat--${pos}');
  });
  it('renders the table as a circular board with a felt + centre', () => {
    expect(durak).toContain('durak-board durak-board--${state.players.length}');
    expect(durak).toContain('durak-board__felt');
    expect(durak).toContain('durak-centre');
  });
  it('puts the deck/trump in the centre of the felt, not the topbar', () => {
    // The DurakDeck sits inside .durak-centre; the topbar no longer renders it.
    const centreIdx = durak.indexOf('durak-centre');
    const deckIdx = durak.indexOf('<DurakDeck');
    expect(deckIdx).toBeGreaterThan(centreIdx);
    expect(durak).not.toContain('durak-topbar__right');
  });
});

describe('King circular seating is unchanged', () => {
  const tp = read('./components/TablePlayers.tsx');
  it('keeps clockwise relative seat positions around the oval', () => {
    expect(tp).toContain('(seatIndex - viewerSeat + count) % count');
    expect(tp).toContain("tseat--${pos}");
  });
});
