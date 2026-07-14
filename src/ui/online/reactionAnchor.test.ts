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

  // Stage 29.5 — Tarneeb mirrors its seats left↔right on screen, so reactions must use the
  // mirrored convention (rel = mySeat − fromSeat) or a remote viewer sees the chip on the wrong side.
  describe('mirrored layouts (Tarneeb)', () => {
    it('the sender still anchors to the bottom for every seat (why the sender never saw the bug)', () => {
      for (let seat = 0; seat < 4; seat++) {
        expect(reactionAnchorForSender(seat, seat, 4, true)).toBe('bottom');
      }
    });

    it('4 players mirrored: left/right swap vs the forward mapping; the partner (top) is unchanged', () => {
      // viewer = seat 0. Forward would give seat 1 → left, seat 3 → right; mirrored flips them.
      expect(reactionAnchorForSender(1, 0, 4, true)).toBe('right');
      expect(reactionAnchorForSender(3, 0, 4, true)).toBe('left');
      expect(reactionAnchorForSender(2, 0, 4, true)).toBe('top'); // opposite seat is symmetric
      // viewer = seat 2 (rotation is relative).
      expect(reactionAnchorForSender(3, 2, 4, true)).toBe('right');
      expect(reactionAnchorForSender(1, 2, 4, true)).toBe('left');
      expect(reactionAnchorForSender(0, 2, 4, true)).toBe('top');
    });

    it('mirrored matches the screen seatPosition (viewerSeat − seat) for every viewer/sender pair', () => {
      // TarneebGameScreen seats a player at POSITIONS[(viewer − seat + 4) % 4],
      // POSITIONS = ['bottom','left','top','right']. The anchor must agree.
      const POSITIONS = ['bottom', 'left', 'top', 'right'] as const;
      for (let viewer = 0; viewer < 4; viewer++) {
        for (let sender = 0; sender < 4; sender++) {
          const screen = POSITIONS[(viewer - sender + 4) % 4];
          expect(reactionAnchorForSender(sender, viewer, 4, true)).toBe(screen);
        }
      }
    });
  });
});
