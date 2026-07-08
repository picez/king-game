// ---------------------------------------------------------------------------
// Tarneeb redaction (TARNEEB_RULES §13). A viewer sees only their own hand; every
// other hand is face-down placeholders (count kept). Everything else — bids,
// passes, highest bid, declarer, trump, the current trick, completed-trick counts,
// and team scores — is PUBLIC. Redaction is pure and must never mutate the input.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { tarneebBotAction } from './ai';
import { getActingTarneebSeat } from './rules';
import { tarneebRedactStateFor } from './redact';
import type { TarneebState } from './types';

/** A mid-play Tarneeb state (bids, declarer, trump, a card on the table). */
function playingState(seed: number): TarneebState {
  const rng = makeRng(seed);
  let s = tarneebReducer(null, {
    type: 'START_GAME',
    playerNames: ['S0', 'S1', 'S2', 'S3'],
    playerTypes: ['human', 'human', 'human', 'human'],
    dealerSeat: 0,
  }, { rng }) as TarneebState;
  // Auto-drive the auction + trump + one card so the trick/trump/bids are set.
  let guard = 0;
  while (guard++ < 200) {
    const seat = getActingTarneebSeat(s);
    if (seat == null) break;
    if (s.phase === 'playing' && s.currentTrick && s.currentTrick.plays.length >= 1) break;
    s = tarneebReducer(s, tarneebBotAction(s, seat), { rng })!;
  }
  return s;
}

describe('tarneebRedactStateFor', () => {
  it('shows the viewer their own hand and hides the other three (count kept)', () => {
    const s = playingState(7);
    const view = tarneebRedactStateFor(s, 1); // viewer at seat 1
    expect(view.handsBySeat[1]).toEqual(s.handsBySeat[1]);
    for (const seat of [0, 2, 3]) {
      expect(view.handsBySeat[seat]).toHaveLength(s.handsBySeat[seat].length);
      expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
    }
  });

  it('keeps every public field intact', () => {
    const s = playingState(7);
    const view = tarneebRedactStateFor(s, 1);
    expect(view.phase).toBe(s.phase);
    expect(view.bids).toEqual(s.bids);
    expect(view.passed).toEqual(s.passed);
    expect(view.highestBid).toEqual(s.highestBid);
    expect(view.declarerSeat).toBe(s.declarerSeat);
    expect(view.declarerTeam).toBe(s.declarerTeam);
    expect(view.trumpSuit).toBe(s.trumpSuit);
    expect(view.dealerSeat).toBe(s.dealerSeat);
    expect(view.currentSeat).toBe(s.currentSeat);
    expect(view.currentTrick).toEqual(s.currentTrick);
    expect(view.completedTricks).toEqual(s.completedTricks);
    expect(view.tricksByTeam).toEqual(s.tricksByTeam);
    expect(view.scoresByTeam).toEqual(s.scoresByTeam);
  });

  it('a spectator (null) sees no real hand at all', () => {
    const s = playingState(3);
    const view = tarneebRedactStateFor(s, null);
    expect(view.handsBySeat.every((h) => h.every((c) => c.rank === '?'))).toBe(true);
  });

  it('does not mutate the authoritative state', () => {
    const s = playingState(9);
    const before = JSON.stringify(s);
    tarneebRedactStateFor(s, 0);
    tarneebRedactStateFor(s, null);
    expect(JSON.stringify(s)).toBe(before);
    // The real hands still hold real cards (no placeholder leaked back in).
    expect(s.handsBySeat.every((h) => h.every((c) => c.rank !== '?'))).toBe(true);
  });

  it('never leaks a non-viewer hand into the serialized view (JSON scan)', () => {
    const s = playingState(15);
    const viewerSeat = 2;
    const view = tarneebRedactStateFor(s, viewerSeat);
    // Every card string that appears for a non-viewer seat must be a placeholder.
    for (const seat of [0, 1, 3]) {
      const json = JSON.stringify(view.handsBySeat[seat]);
      expect(json).not.toContain('"rank":"A"');
      expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
    }
  });
});
