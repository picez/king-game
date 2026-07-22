import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import PokerRecoveryBanner from '../poker/PokerRecoveryBanner';
import Lobby from './Lobby';
import type { RoomSnapshot } from '../../net/messages';

// Stage 37.7.5 BEHAVIORAL UI test (real render via renderToStaticMarkup, not a source scan):
// the recovery banner renders the right PUBLIC copy + leaks no economy fields, and the Lobby
// disables the Start control when the table is frozen.

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe('PokerRecoveryBanner renders public status only', () => {
  it('cancelled → an explanatory banner, no matchId/userId/escrow', () => {
    const out = html(createElement(PokerRecoveryBanner, { status: 'cancelled' }));
    expect(out).toContain('poker-recovery-banner--cancelled');
    expect(out).toMatch(/previous match was cancelled/i);
    expect(out).toMatch(/refunded/i);
    expect(out).not.toMatch(/matchId|userId|escrow|buyIn/i);
  });
  it('frozen → a temporarily-unavailable banner', () => {
    const out = html(createElement(PokerRecoveryBanner, { status: 'frozen' }));
    expect(out).toContain('poker-recovery-banner--frozen');
    expect(out).toMatch(/temporarily unavailable/i);
  });
  it('no status → renders nothing', () => {
    expect(html(createElement(PokerRecoveryBanner, {}))).toBe('');
  });
});

function pokerRoom(recovery?: 'cancelled' | 'frozen'): RoomSnapshot {
  return {
    code: 'PKR1', gameType: 'poker', playerCount: 2, modeSelectionType: 'fixed', turnTimerSec: 0,
    started: false, hasPassword: false, pokerBuyIn: 20000, pokerSmallBlind: 100, pokerBigBlind: 200,
    ...(recovery ? { pokerRecovery: recovery } : {}),
    members: [
      { clientId: 'h', name: 'Host', role: 'player', seatIndex: 0, isHost: true, connected: true, type: 'human', avatar: '🙂' },
      { clientId: 'b', name: 'Bob', role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'human', avatar: '🙂' },
    ],
  } as RoomSnapshot;
}

const lobbyProps = {
  isHost: true, myPlayerId: 'player-0', myClientId: 'h',
  onStart: () => {}, onLeave: () => {}, onKick: () => {}, onAddBot: () => {}, onSetTimer: () => {},
  error: null, inviteSlot: null,
};

describe('Lobby recovery controls (behavioral render)', () => {
  it('frozen room → the Start button is DISABLED and the banner shows', () => {
    const out = html(createElement(Lobby, { room: pokerRoom('frozen'), ...lobbyProps }));
    expect(out).toContain('poker-recovery-banner--frozen');
    // The host Start button is rendered disabled.
    expect(out).toMatch(/<button[^>]*btn--large[^>]*disabled/);
  });
  it('cancelled room (2 seated) → Start is ENABLED with a "start a new match" label; banner shows', () => {
    const out = html(createElement(Lobby, { room: pokerRoom('cancelled'), ...lobbyProps }));
    expect(out).toContain('poker-recovery-banner--cancelled');
    expect(out).toMatch(/Start a new match/i);
    // The large primary Start button is NOT disabled here (enough players, not frozen).
    const btn = out.match(/<button[^>]*btn--primary btn--large[^>]*>/)?.[0] ?? '';
    expect(btn).not.toMatch(/disabled/);
  });
  it('no recovery → no banner', () => {
    const out = html(createElement(Lobby, { room: pokerRoom(), ...lobbyProps }));
    expect(out).not.toContain('poker-recovery-banner');
  });
});
