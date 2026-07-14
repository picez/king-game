import { describe, it, expect } from 'vitest';
import { tarneebRankRows } from './tarneebScoreTable';
import type { TarneebState } from '../../games/tarneeb/types';

// Minimal fixtures: the helper only reads variant / players / the score+trick ledgers /
// highestBid / declarer fields, so a hand-built partial state is enough (and keeps the test
// independent of the reducer). teamOfSeat: A = seats 0 & 2, B = seats 1 & 3.
const PLAYERS = [
  { seatIndex: 0, name: 'Ann' },
  { seatIndex: 1, name: 'Ben' },
  { seatIndex: 2, name: 'Cat' },
  { seatIndex: 3, name: 'Dan' },
];

function solo(over: Partial<TarneebState>): TarneebState {
  return {
    variant: 'solo', players: PLAYERS,
    scoresBySeat: [0, 0, 0, 0], tricksBySeat: [0, 0, 0, 0],
    scoresByTeam: { A: 0, B: 0 }, tricksByTeam: { A: 0, B: 0 },
    highestBid: null, declarerSeat: null, declarerTeam: null,
    ...over,
  } as unknown as TarneebState;
}
function pairs(over: Partial<TarneebState>): TarneebState {
  return {
    variant: 'pairs', players: PLAYERS,
    scoresByTeam: { A: 0, B: 0 }, tricksByTeam: { A: 0, B: 0 },
    highestBid: null, declarerSeat: null, declarerTeam: null,
    ...over,
  } as unknown as TarneebState;
}

describe('tarneebRankRows — Solo (Stage 29.7)', () => {
  it('returns 4 seat rows sorted by total score descending', () => {
    const rows = tarneebRankRows(solo({ scoresBySeat: [5, 12, 12, 3], tricksBySeat: [1, 4, 2, 0] }), 0, 3, false);
    expect(rows.map((r) => r.seat)).toEqual([1, 2, 0, 3]); // 12,12,5,3 — tie 1<2 by seat
    expect(rows.every((r) => r.team === null)).toBe(true);
  });

  it('the tie-break is stable by seat (no jitter when scores are equal)', () => {
    const rows = tarneebRankRows(solo({ scoresBySeat: [0, 0, 0, 0] }), 0, null, false);
    expect(rows.map((r) => r.seat)).toEqual([0, 1, 2, 3]);
  });

  it('carries the bidder marker + bid amount, this-hand tricks, and total score from the ledgers', () => {
    const rows = tarneebRankRows(
      solo({ scoresBySeat: [5, 12, 12, 3], tricksBySeat: [1, 4, 2, 0], highestBid: { seat: 1, amount: 8 }, declarerSeat: 1 }),
      0, 3, false,
    );
    const bidder = rows.find((r) => r.seat === 1)!;
    expect(bidder.isBidder).toBe(true);
    expect(bidder.bidAmount).toBe(8);
    expect(bidder.tricks).toBe(4);
    expect(bidder.score).toBe(12);
    // Non-bidders never carry an amount.
    expect(rows.filter((r) => r.seat !== 1).every((r) => r.bidAmount === null)).toBe(true);
  });

  it('highlights me + the acting seat; leader only once someone is ahead', () => {
    const rows = tarneebRankRows(solo({ scoresBySeat: [5, 12, 12, 3] }), 0, 3, false);
    expect(rows.find((r) => r.seat === 0)!.isMe).toBe(true);
    expect(rows.find((r) => r.seat === 3)!.isTurn).toBe(true);
    // Both seats on the top score (12) are leaders; 5/3 are not.
    expect(rows.filter((r) => r.isLeader).map((r) => r.seat).sort()).toEqual([1, 2]);
  });

  it('a 0–0 start marks NO leader, and `blocked` suppresses the turn highlight', () => {
    const rows = tarneebRankRows(solo({}), 0, 2, true);
    expect(rows.some((r) => r.isLeader)).toBe(false);
    expect(rows.some((r) => r.isTurn)).toBe(false);
  });
});

describe('tarneebRankRows — Pairs (Stage 29.7)', () => {
  it('returns two team rows sorted by score, with the bid marker on the declarer team', () => {
    const rows = tarneebRankRows(
      pairs({ scoresByTeam: { A: 20, B: 25 }, tricksByTeam: { A: 6, B: 7 }, highestBid: { seat: 1, amount: 9 }, declarerSeat: 1, declarerTeam: 'B' }),
      0, 2, false, // humanSeat 0 → team A; actingSeat 2 → team A
    );
    expect(rows.map((r) => r.team)).toEqual(['B', 'A']); // 25 then 20
    const b = rows[0], a = rows[1];
    expect(b.team).toBe('B');
    expect(b.score).toBe(25);
    expect(b.tricks).toBe(7);
    expect(b.isBidder).toBe(true);
    expect(b.bidAmount).toBe(9);
    expect(a.isMe).toBe(true);      // my team
    expect(a.isTurn).toBe(true);    // my partner/me acting
    expect(a.isBidder).toBe(false);
    expect(rows.every((r) => r.seat === null)).toBe(true);
  });

  it('during bidding (no declarer yet) the marker follows the current highest bidder’s team', () => {
    const rows = tarneebRankRows(pairs({ highestBid: { seat: 3, amount: 6 } }), 0, null, false); // seat 3 → team B
    expect(rows.find((r) => r.team === 'B')!.isBidder).toBe(true);
    expect(rows.find((r) => r.team === 'B')!.bidAmount).toBe(6);
    expect(rows.find((r) => r.team === 'A')!.isBidder).toBe(false);
  });

  it('no bid at all → nobody is marked as bidder', () => {
    const rows = tarneebRankRows(pairs({}), 0, null, false);
    expect(rows.every((r) => !r.isBidder && r.bidAmount === null)).toBe(true);
  });
});
