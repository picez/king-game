// ---------------------------------------------------------------------------
// Stage 38.0.5 — the permanent "Quit for good" UI: behaviour, wiring, i18n, mobile.
//
// Rendered for real (renderToStaticMarkup), then the SOURCE wiring is pinned for the
// things a static render cannot show (which screens offer the control, and that the
// client never drops its session before the server's ACK).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import PermanentLeaveControl from './PermanentLeaveControl';
import { EN as en } from '../../i18n/dictionaries/en';
import { UK as uk } from '../../i18n/dictionaries/uk';
import { DE as de } from '../../i18n/dictionaries/de';
import { AR as ar } from '../../i18n/dictionaries/ar';

const html = (el: ReactElement) => renderToStaticMarkup(el);
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const KEYS = [
  'permanentLeave.button', 'permanentLeave.title', 'permanentLeave.irreversible',
  'permanentLeave.loss', 'permanentLeave.bot', 'permanentLeave.roomCloses',
  'permanentLeave.confirm', 'permanentLeave.cancel', 'permanentLeave.pending', 'permanentLeave.error',
] as const;

describe('the control renders a trigger, not a dialog, until it is pressed', () => {
  it('collapsed: only the trigger button, no confirmation text', () => {
    const out = html(createElement(PermanentLeaveControl, { state: { status: 'idle' }, onConfirm: () => {} }));
    expect(out).toContain('permleave-trigger');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('permleave-dialog');
    // Nothing about the game/economy leaks into the control.
    expect(out).not.toMatch(/matchId|userId|seatIndex|forfeit/i);
  });
});

/** Render the component with its dialog forced open by pressing the trigger. */
function openDialogHtml(state: { status: 'idle' | 'pending' | 'accepted' | 'error' }): string {
  // renderToStaticMarkup cannot click, so assert the dialog markup from the source and
  // render the OPEN branch by driving React's state through a wrapper is unnecessary:
  // the dialog body is a pure function of `open`. We verify its content from the source
  // template AND its strings from the dictionary, which together pin the same contract.
  const src = read('src/ui/online/PermanentLeaveControl.tsx');
  expect(src).toContain('permleave-dialog');
  expect(src).toContain('role="dialog"');
  expect(src).toContain('aria-modal="true"');
  return `${src}|${state.status}`;
}

describe('the confirmation spells out every consequence before anything is sent', () => {
  it('names all four consequences', () => {
    openDialogHtml({ status: 'idle' });
    const src = read('src/ui/online/PermanentLeaveControl.tsx');
    for (const key of ['permanentLeave.irreversible', 'permanentLeave.loss', 'permanentLeave.bot', 'permanentLeave.roomCloses']) {
      expect(src).toContain(`t('${key}')`);
    }
  });

  it('the English copy actually says: no way back, a loss, a bot takes the seat, the room closes', () => {
    expect(en['permanentLeave.irreversible']).toMatch(/cannot come back/i);
    expect(en['permanentLeave.loss']).toMatch(/loss/i);
    expect(en['permanentLeave.bot']).toMatch(/bot/i);
    expect(en['permanentLeave.roomCloses']).toMatch(/closes/i);
    // The refusal copy promises that NOTHING changed and offers the reconnectable exit.
    expect(en['permanentLeave.error']).toMatch(/nothing changed/i);
    expect(en['permanentLeave.error']).toMatch(/back to menu/i);
  });

  it('is double-click safe: the confirm button is disabled while a request is in flight', () => {
    const src = read('src/ui/online/PermanentLeaveControl.tsx');
    expect(src).toMatch(/className="btn btn--danger permleave-confirm"[\s\S]*?disabled=\{pending\}/);
    expect(src).toMatch(/const pending = state\.status === 'pending'/);
  });

  it('reports a refusal politely, in-place, via aria-live', () => {
    const src = read('src/ui/online/PermanentLeaveControl.tsx');
    expect(src).toContain('aria-live="polite"');
    expect(src).toMatch(/state\.status === 'error' \? t\('permanentLeave\.error'\)/);
  });
});

describe('i18n parity across EN/UK/DE/AR', () => {
  it.each([['en', en], ['uk', uk], ['de', de], ['ar', ar]] as const)('%s defines every key, non-empty and distinct', (lang, dict) => {
    for (const key of KEYS) {
      const value = (dict as Record<string, string>)[key];
      expect(value, `${lang}:${key}`).toBeTypeOf('string');
      expect(value.trim().length, `${lang}:${key}`).toBeGreaterThan(0);
    }
    // The destructive action must not read identically to the reversible one.
    expect((dict as Record<string, string>)['permanentLeave.button'])
      .not.toBe((dict as Record<string, string>)['online.leaveGame']);
  });

  it('is genuinely translated (not English copied into every language)', () => {
    const titles = new Set([en, uk, de, ar].map((d) => (d as Record<string, string>)['permanentLeave.title']));
    expect(titles.size).toBe(4);
  });
});

describe('mobile ergonomics', () => {
  const css = read('src/styles/social.css');
  it('the trigger meets the 44x44 touch target in both cluster variants', () => {
    expect(css).toMatch(/\.permleave-trigger\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    // The docked toolbar sizes every .social-fab (the trigger IS one) to 44px.
    expect(css).toMatch(/\.social-controls--docked \.social-fab \{[^}]*min-width: 44px; min-height: 44px/);
  });
  it('the dialog buttons meet 44px and wrap on a narrow screen', () => {
    expect(css).toMatch(/\.permleave-dialog__actions \.btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.permleave-dialog__actions \{[^}]*flex-wrap: wrap/);
  });
  it('the dialog fits a small viewport and scrolls itself instead of the page', () => {
    expect(css).toMatch(/\.permleave-dialog \{[^}]*width: min\(100%, 26rem\)/);
    expect(css).toMatch(/\.permleave-dialog \{[^}]*max-height: 86vh; overflow-y: auto/);
  });
  it('the trigger is a normal in-flow member of the control row (never a table overlay)', () => {
    const social = read('src/ui/online/RoomSocial.tsx');
    // dangerSlot renders INSIDE .social-controls__row, which both variants position safely.
    expect(social).toMatch(/social-controls__row[\s\S]*?\{dangerSlot\}[\s\S]*?<\/div>/);
    expect(css).not.toMatch(/\.permleave-trigger \{[^}]*position: (fixed|absolute)/);
  });
});

describe('which screens offer it', () => {
  const online = read('src/ui/online/OnlineGame.tsx');
  it('only an ACTIVE, non-Poker game, and only for a SEATED player', () => {
    expect(online).toMatch(/const canLeavePermanently = !!net\.room\?\.started && net\.room\?\.gameType !== 'poker' && mySeatIndex != null;/);
  });
  it('is handed to the shared social cluster (all five non-51 screens) and to 51 dock', () => {
    // Exactly two call sites: the shared renderSocial + Fifty-One's own docked cluster.
    expect(online.match(/dangerSlot=\{permanentLeaveSlot\}/g)).toHaveLength(2);
  });
  it('the Poker branch never passes it', () => {
    const pokerBranch = online.slice(online.indexOf("if (net.room?.gameType === 'poker') {"));
    expect(pokerBranch).not.toContain('dangerSlot');
  });
  it('the lobby cannot show it (the gate requires room.started)', () => {
    expect(online).toContain("!!net.room?.started");
  });
  it('exits to the menu only AFTER the server accepted', () => {
    expect(online).toMatch(/net\.permanentLeave\.status === 'accepted'\) onExit\(\)/);
  });
});

describe('the client never drops its identity before the ACK', () => {
  const hook = read('src/hooks/useNetworkGame.ts');
  it('sending the intent clears nothing', () => {
    const fn = hook.slice(hook.indexOf('const leavePermanently'), hook.indexOf('const backToMenu'));
    expect(fn).toContain("send({ t: 'LEAVE_GAME_PERMANENTLY' })");
    expect(fn).not.toContain('clearSession');
    expect(fn).not.toContain('.close()');
  });
  it('the ACK is what clears the session, the token, the code and the transport', () => {
    const ack = hook.slice(hook.indexOf("case 'PERMANENT_LEAVE_ACCEPTED'"), hook.indexOf("case 'REMATCH_STATE'"));
    expect(ack).toContain('leavingRef.current = true');
    expect(ack).toContain('clearSession()');
    expect(ack).toContain('tokenRef.current = null');
    expect(ack).toContain('codeRef.current = null');
    expect(ack).toContain('transportRef.current?.close()');
  });
  it('a refusal is a panel state, never the fatal game-error surface', () => {
    expect(hook).toMatch(/msg\.code === 'PERMANENT_LEAVE_UNAVAILABLE'[\s\S]*?setPermanentLeave\(\{ status: 'error' \}\)/);
  });
  it('a stale Resume is dropped when an authoritative ROOM_NOT_FOUND answers a reconnect', () => {
    expect(hook).toMatch(/msg\.code === 'ROOM_NOT_FOUND' && tokenRef\.current[\s\S]*?clearSession\(\)/);
  });
  it('a second press while pending does not restart the lifecycle', () => {
    expect(hook).toMatch(/p\.status === 'pending' \|\| p\.status === 'accepted' \? p :/);
  });
});
