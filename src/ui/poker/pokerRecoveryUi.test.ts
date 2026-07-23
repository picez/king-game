import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import PokerGameScreen from './PokerGameScreen';
import PokerFinished from './PokerFinished';
import { pokerReducer } from '../../games/poker/engine';
import type { PokerState } from '../../games/poker/types';
import type { RematchUi } from '../online/RematchControls';

// Stage 37.7.6 BEHAVIORAL UI tests (real render via renderToStaticMarkup):
// FAIL 2 — a frozen / settlement-pending online poker table is FULLY read-only (no
// bet/fold/check/call/raise/all-in, no next-hand); FAIL 3 — the online finish screen wires
// the shared RematchControls (and suppresses it under recovery).

const html = (el: ReactElement) => renderToStaticMarkup(el);

function bettingState(): PokerState {
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: ['Alice', 'Bob'], playerTypes: ['human', 'human'],
    playerCount: 2, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 },
  })!;
}

describe('FAIL 2 — frozen/settlement-pending poker table is read-only', () => {
  it('readOnly hides ALL action controls even when the viewer is the actor', () => {
    const state = bettingState();
    const dispatch = vi.fn();
    const out = html(createElement(PokerGameScreen, { state, mySeat: state.toActSeat, apply: dispatch, onExit: () => {}, online: true, readOnly: true }));
    // No bet/raise/all-in controls, no primary Fold/Check/Call row, no wager slider.
    expect(out).not.toContain('poker-actions');
    expect(out).not.toContain('poker-wager-go');
    expect(out).not.toContain('poker-slider');
    expect(out).not.toMatch(/>Fold<|>Check<|>Call/);
    // A "paused" note is shown instead.
    expect(out).toContain('poker-waiting--paused');
    // A static render offers no clickable action → dispatch is never invoked.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('WITHOUT readOnly, the actor DOES get action controls (control case)', () => {
    const state = bettingState();
    const out = html(createElement(PokerGameScreen, { state, mySeat: state.toActSeat, apply: () => {}, onExit: () => {}, online: true }));
    expect(out).toContain('poker-actions');
  });
});

function finishedState(): PokerState {
  return {
    winnerSeat: 0,
    players: [{ id: 'p0', name: 'Alice', seatIndex: 0, type: 'human' }, { id: 'p1', name: 'Bob', seatIndex: 1, type: 'human' }],
    stacksBySeat: [10000, 0],
    phase: 'game_finished',
  } as unknown as PokerState;
}

const rematchUi = (): RematchUi => ({
  progress: null,
  members: [
    { clientId: 'h', name: 'Alice', role: 'player', seatIndex: 0, isHost: true, connected: true, type: 'human', avatar: '🙂' },
    { clientId: 'b', name: 'Bob', role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'human', avatar: '🙂' },
  ],
  myClientId: 'h', onReady: () => {}, onDecline: () => {},
});

describe('FAIL 3 — Poker finish wires RematchControls', () => {
  it('online (rematch provided) → renders the shared RematchControls', () => {
    const out = html(createElement(PokerFinished, { state: finishedState(), mySeat: 0, onExit: () => {}, rematch: rematchUi() }));
    expect(out).toContain('rematch');            // RematchControls container
    expect(out).toMatch(/Play again/i);
  });
  it('local (no rematch, onPlayAgain) → the local Play Again button', () => {
    const out = html(createElement(PokerFinished, { state: finishedState(), mySeat: 0, onExit: () => {}, onPlayAgain: () => {} }));
    expect(out).not.toContain('class="rematch"');
    expect(out).toMatch(/btn--primary/);
  });
  it('frozen finish (rematch suppressed) → banner shown, NO rematch control', () => {
    const out = html(createElement(PokerFinished, { state: finishedState(), mySeat: 0, onExit: () => {}, rematch: null, recovery: 'frozen' }));
    expect(out).toContain('poker-recovery-banner--frozen');
    expect(out).not.toContain('class="rematch"');
  });
});
