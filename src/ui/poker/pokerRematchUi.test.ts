import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';

// Stage 37.7.7 FAIL 3 (behavioral UI): the online rematch controls REALLY invoke onReady/onDecline,
// a payout-pending / frozen finished table renders NO active rematch controls, and the recovery
// banner appears EXACTLY ONCE (never duplicated between OnlineGame and the poker screens).
// i18n is mocked so RematchControls can be invoked as a pure function to reach its click handlers.
vi.mock('../../i18n', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  useI18n: () => ({ t: (k: string) => k, lang: 'en', setLang: () => {}, dir: 'ltr' }),
}));

import RematchControls, { type RematchUi } from '../online/RematchControls';
import PokerOnlineGame from './PokerOnlineGame';
import { pokerReducer } from '../../games/poker/engine';
import type { PokerState } from '../../games/poker/types';

const html = (el: ReactElement) => renderToStaticMarkup(el);

// Recursively collect every <button> element in a rendered React tree.
function buttons(node: unknown, acc: Array<{ onClick?: () => void; className?: string; text: string }> = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => buttons(n, acc)); return acc; }
  const el = node as { type?: unknown; props?: { onClick?: () => void; className?: string; children?: unknown } };
  if (el.type === 'button') {
    const text = JSON.stringify(el.props?.children ?? '');
    acc.push({ onClick: el.props?.onClick, className: el.props?.className, text });
  }
  if (el.props?.children != null) buttons(el.props.children, acc);
  return acc;
}

function rematchUi(over: Partial<RematchUi> = {}): RematchUi {
  return {
    progress: over.progress ?? null,
    members: [
      { clientId: 'h', name: 'Alice', role: 'player', seatIndex: 0, isHost: true, connected: true, type: 'human', avatar: '🙂' },
      { clientId: 'b', name: 'Bob', role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'human', avatar: '🙂' },
    ] as RematchUi['members'],
    myClientId: 'h',
    onReady: over.onReady ?? (() => {}),
    onDecline: over.onDecline ?? (() => {}),
  };
}

describe('FAIL 3 — RematchControls click handlers really fire', () => {
  it('pressing "Play again" invokes onReady', () => {
    const onReady = vi.fn();
    const tree = RematchControls(rematchUi({ onReady })) as unknown;
    const btns = buttons(tree);
    const play = btns.find((b) => b.text.includes('rematch.playAgain'));
    expect(play).toBeTruthy();
    play!.onClick!();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('pressing "Cancel" (while ready, waiting on others) invokes onDecline', () => {
    const onDecline = vi.fn();
    // I am ready; the other human is not → the cancel/decline button is shown.
    const tree = RematchControls(rematchUi({ onDecline, progress: { ready: ['h'], needed: 2 } })) as unknown;
    const cancel = buttons(tree).find((b) => b.text.includes('rematch.cancel'));
    expect(cancel).toBeTruthy();
    cancel!.onClick!();
    expect(onDecline).toHaveBeenCalledOnce();
  });
});

function finishedState(): PokerState {
  return {
    winnerSeat: 0, phase: 'game_finished',
    players: [{ id: 'p0', name: 'Alice', seatIndex: 0, type: 'human' }, { id: 'p1', name: 'Bob', seatIndex: 1, type: 'human' }],
    stacksBySeat: [10000, 0],
  } as unknown as PokerState;
}
function bettingState(): PokerState {
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: ['Alice', 'Bob'], playerTypes: ['human', 'human'],
    playerCount: 2, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 },
  })!;
}

const count = (h: string, needle: RegExp) => (h.match(needle) ?? []).length;

describe('FAIL 3 — payout-pending / frozen finished table has NO active rematch controls', () => {
  for (const recovery of ['payout_pending', 'frozen'] as const) {
    it(`${recovery}: finished online poker suppresses RematchControls but shows ONE banner`, () => {
      const out = html(createElement(PokerOnlineGame, {
        state: finishedState(), myPlayerId: 'player-0', dispatch: () => {}, onExit: () => {},
        rematch: rematchUi(), recovery,
      }));
      expect(out).not.toContain('class="rematch"');            // no active rematch controls
      expect(out).not.toMatch(/rematch\.playAgain/);
      expect(count(out, /poker-recovery-banner--/g)).toBe(1);  // exactly one banner
    });
  }

  it('a NORMAL finished online table (no recovery) DOES render RematchControls and no banner', () => {
    const out = html(createElement(PokerOnlineGame, {
      state: finishedState(), myPlayerId: 'player-0', dispatch: () => {}, onExit: () => {},
      rematch: rematchUi(), recovery: undefined,
    }));
    expect(out).toContain('class="rematch"');
    expect(count(out, /poker-recovery-banner--/g)).toBe(0);
  });
});

describe('FAIL 3 — the recovery banner is rendered exactly ONCE (no duplicate)', () => {
  it('an ACTIVE frozen table shows exactly one banner (owned by PokerOnlineGame)', () => {
    const out = html(createElement(PokerOnlineGame, {
      state: bettingState(), myPlayerId: 'player-0', dispatch: () => {}, onExit: () => {},
      rematch: rematchUi(), recovery: 'frozen',
    }));
    expect(count(out, /poker-recovery-banner--/g)).toBe(1);
  });

  it('OnlineGame no longer renders its own PokerRecoveryBanner in the poker branch (source guard)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/ui/online/OnlineGame.tsx', 'utf8');
    // The poker branch must NOT import/render PokerRecoveryBanner — PokerOnlineGame owns it now.
    expect(src).not.toContain('PokerRecoveryBanner');
  });
});
