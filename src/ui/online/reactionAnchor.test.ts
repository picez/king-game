import { describe, it, expect } from 'vitest';
import { reactionAnchorForSender } from './reactionAnchor';

describe('reactionAnchorForSender (Stage 27.1)', () => {
  it('the viewer (own reaction) always anchors to the bottom', () => {
    for (const n of [2, 3, 4, 5]) {
      for (let seat = 0; seat < n; seat++) {
        expect(reactionAnchorForSender(seat, seat, n)).toBe('bottom');
      }
    }
  });

  it('4 players: others map clockwise to left / top / right (viewer at bottom)', () => {
    // viewer = seat 0 → seat 1 left, seat 2 top, seat 3 right.
    expect(reactionAnchorForSender(1, 0, 4)).toBe('left');
    expect(reactionAnchorForSender(2, 0, 4)).toBe('top');
    expect(reactionAnchorForSender(3, 0, 4)).toBe('right');
    // viewer = seat 2 → seat 3 left, seat 0 top, seat 1 right (rotation is relative).
    expect(reactionAnchorForSender(3, 2, 4)).toBe('left');
    expect(reactionAnchorForSender(0, 2, 4)).toBe('top');
    expect(reactionAnchorForSender(1, 2, 4)).toBe('right');
  });

  it('3 players: the two opponents anchor left / right', () => {
    expect(reactionAnchorForSender(1, 0, 3)).toBe('left');
    expect(reactionAnchorForSender(2, 0, 3)).toBe('right');
  });

  it('2 players: the opponent anchors to the top', () => {
    expect(reactionAnchorForSender(1, 0, 2)).toBe('top');
  });

  it('falls back to center when the sender / viewer seat is unknown or the layout is unsupported', () => {
    expect(reactionAnchorForSender(null, 0, 4)).toBe('center');   // spectator sender
    expect(reactionAnchorForSender(1, null, 4)).toBe('center');   // viewer unseated
    expect(reactionAnchorForSender(1, 0, 0)).toBe('center');      // no seats (lobby / unknown)
    expect(reactionAnchorForSender(1, 0, 6)).toBe('center');      // unsupported count
  });
});
