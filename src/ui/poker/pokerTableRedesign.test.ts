import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import PokerGameScreen from './PokerGameScreen';
import { pokerReducer } from '../../games/poker/engine';
import { pokerRedactStateFor } from '../../games/poker/redact';
import { seatLayoutFor } from './pokerSeatLayout';
import type { PokerState } from '../../games/poker/types';

// Stage 41.1 — the owner found the table hard to use on a phone. The geometry is proven
// in a real browser by `npm run layout:poker`; these tests pin the CONTRACT behind it.

function betting(): PokerState {
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: ['Alice', 'Bob', 'Cara', 'Dan'], playerTypes: ['human', 'ai', 'ai', 'ai'],
    playerCount: 4, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 },
  })!;
}

function render(extra: Record<string, unknown> = {}) {
  const raw = betting();
  const s = pokerRedactStateFor(raw, raw.toActSeat);
  return renderToStaticMarkup(createElement(PokerGameScreen, {
    state: s, mySeat: s.toActSeat, apply: () => {}, onExit: () => {}, online: true, ...extra,
  }));
}

describe('own seat', () => {
  it('shows the viewer\'s hole cards LARGE with the current hand strength', () => {
    const out = render();
    const me = out.slice(out.indexOf('poker-pod--me'));
    expect((me.match(/poker-card--lg/g) ?? []).length).toBe(2);
    expect(me).toContain('poker-pod__strength');
    // Opponents keep small face-down backs.
    expect(out).toContain('poker-card--sm poker-card--back');
  });
});

describe('bets are chips on the felt, facing the pot', () => {
  it('every layout names a bet side for every seat', () => {
    for (let n = 2; n <= 6; n++) {
      for (const p of seatLayoutFor(n)) expect(['up', 'down', 'left', 'right']).toContain(p.bet);
      expect(seatLayoutFor(n)[0].bet).toBe('up'); // the viewer pushes chips up toward the pot
    }
  });
  it('the blinds render as `.poker-bet` chips, not as a badge on the plate', () => {
    const out = render();
    expect(out).toContain('poker-bet poker-bet--');
    expect(out).not.toContain('poker-pod__bet');
  });
});

describe('the betting row', () => {
  it('is one row — Fold | Check/Call | Raise — with the sizing panel shut by default', () => {
    const out = render();
    expect(out).toContain('class="btn poker-fold"');
    expect(out).toContain('poker-raise-toggle');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('poker-actions__wager');
    expect(out).not.toContain('poker-slider');
  });
});

describe('turn timer and exit', () => {
  it('draws the countdown on the ACTING seat\'s plate', () => {
    const out = render({ turnTimer: createElement('span', { className: 'probe-timer' }, '20s') });
    const acting = out.slice(out.indexOf('poker-pod--acting'));
    expect(acting.indexOf('probe-timer')).toBeGreaterThan(-1);
    expect(acting.indexOf('probe-timer')).toBeLessThan(acting.indexOf('poker-pod__name'));
    expect((out.match(/probe-timer/g) ?? []).length).toBe(1);
  });

  it('online poker has no 🚪 in the utility row and no timer there — ✕ (with a confirm) is the exit', () => {
    const online = readFileSync(join(process.cwd(), 'src/ui/online/OnlineGame.tsx'), 'utf8');
    const branch = online.slice(online.indexOf("if (net.room?.gameType === 'poker')"), online.indexOf('return roomLayout(', online.indexOf("if (net.room?.gameType === 'poker')")));
    expect(branch).toContain('<RoomSocial');
    expect(branch).not.toContain('onLeaveGame=');
    expect(branch).not.toContain('timerSlot=');
    expect(online).toContain('turnTimer={pokerTimerEl}');
    const screen = readFileSync(join(process.cwd(), 'src/ui/poker/PokerGameScreen.tsx'), 'utf8');
    expect(screen).toContain('onClick={exit}');
    expect(screen).toContain('window.confirm(');
  });
});
