import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import PokerGameScreen from './PokerGameScreen';
import RoomSocial from '../online/RoomSocial';
import { PokerActionLogButton, PokerActionLogPanel } from './PokerActionLog';
import { pokerReducer } from '../../games/poker/engine';
import type { PokerState } from '../../games/poker/types';

// Stage 38.0.3 item B — the owner's production screenshot showed the FIXED social
// cluster sitting on top of the Call/Check button and the wager row. The structural
// fix: poker renders the cluster DOCKED, in normal flow, between the table and the
// action row, and owns which single panel is open.
//
// The pairwise rectangle proof lives in `scripts/poker-layout-qa.mjs` (a real browser,
// real getBoundingClientRect). These tests pin the CONTRACT that makes that geometry
// possible, so it cannot be undone by a refactor.

const html = (el: ReactElement) => renderToStaticMarkup(el);

function betting(): PokerState {
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: ['Alice', 'Bob'], playerTypes: ['human', 'human'],
    playerCount: 2, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 },
  })!;
}

const socialProps = {
  reactions: [], chat: [], myClientId: 'me',
  onReact: () => {}, onChat: () => {}, onChatMedia: () => {},
  notice: null, onClearNotice: () => {},
} as const;

describe('the dock is IN FLOW and ahead of the action row', () => {
  it('PokerGameScreen renders the social slot between the table and the actions', () => {
    const s = betting();
    const out = html(createElement(PokerGameScreen, {
      state: s, mySeat: s.toActSeat, apply: () => {}, onExit: () => {}, online: true,
      socialSlot: createElement('div', { className: 'probe-social' }, 'x'),
    }));
    const table = out.indexOf('poker-table-wrap');
    const dock = out.indexOf('poker-social-dock');
    const actions = out.indexOf('poker-actions');
    expect(table).toBeGreaterThan(-1);
    expect(dock).toBeGreaterThan(table);       // after the table…
    expect(actions).toBeGreaterThan(dock);     // …and BEFORE the action row
    expect(out).toContain('probe-social');
  });

  it('without a social slot nothing extra is rendered (other callers unaffected)', () => {
    const s = betting();
    const out = html(createElement(PokerGameScreen, {
      state: s, mySeat: s.toActSeat, apply: () => {}, onExit: () => {}, online: true,
    }));
    expect(out).not.toContain('poker-social-dock');
  });
});

describe('(38.0.14) ONE in-flow cluster — no variants, no overlay', () => {
  it('renders a normal-flow cluster whatever the caller does', () => {
    const out = html(createElement(RoomSocial, { ...socialProps, handVisible: true }));
    // (38.0.16) The cluster carries no state class any more: the row is always the same
    // row, and the panels live in the social region.
    expect(out).toContain('class="room-social"');
    expect(out).toContain('room-social__bar');
    // The fixed corner cluster and its "raised" lift are gone with the variants.
    expect(out).not.toContain('social-controls');
    expect(out).not.toContain('social-controls--raised');
  });

  it('the open chat is an in-flow section, never a modal', () => {
    const out = html(createElement(RoomSocial, { ...socialProps, openPanel: 'chat' }));
    expect(out).toContain('<section class="chat-panel"');
    expect(out).not.toContain('backdrop');
    expect(out).not.toContain('aria-modal');
    expect(out).not.toContain('chat-drawer');
    expect(out).not.toContain('chat-dialog');
  });
});

describe('exactly one social surface is open at a time', () => {
  const render = (openPanel: 'none' | 'chat' | 'utility') => html(createElement(RoomSocial, {
    ...socialProps, openPanel,
    utilitySlot: createElement(PokerActionLogButton, { open: openPanel === 'utility', unread: false, onToggle: () => {} }),
    utilityPanelSlot: openPanel === 'utility'
      ? createElement(PokerActionLogPanel, { state: betting(), docked: true, onClose: () => {} })
      : null,
  }));

  it('default closed: no chat, no picker, no history panel', () => {
    const out = render('none');
    expect(out).not.toContain('chat-panel');
    expect(out).not.toContain('chat-picker');
    expect(out).not.toContain('poker-log-panel');
  });

  it('chat open → the history panel is not rendered (the picker lives inside the chat)', () => {
    const out = render('chat');
    expect(out).toContain('chat-panel');
    expect(out).toContain('chat-picker-btn');
    expect(out).not.toContain('poker-log-panel');
  });

  it('history open → the chat is not rendered', () => {
    const out = render('utility');
    expect(out).toContain('poker-log-panel');
    expect(out).not.toContain('chat-panel');
  });

  it('(38.0.12) there is no separate reactions surface any more', () => {
    expect(render('chat')).not.toContain('reaction-bar--docked');
    expect(render('none')).not.toContain('reaction-bar');
  });
});

describe('wiring', () => {
  const online = readFileSync(join(process.cwd(), 'src/ui/online/OnlineGame.tsx'), 'utf8');
  const local = readFileSync(join(process.cwd(), 'src/ui/poker/PokerLocalGame.tsx'), 'utf8');
  const social = readFileSync(join(process.cwd(), 'src/ui/online/RoomSocial.tsx'), 'utf8');

  it('the poker branch hands the cluster to the screen and owns the open panel', () => {
    expect(online).toContain('socialSlot={social}');
    expect(online).toContain('openPanel={socialPanel}');
    expect(online).toContain('onPanelChange={setSocialPanel}');
    expect(online).toContain('socialSlot={social}');
  });

  it('poker no longer mounts the floating cluster via renderSocial', () => {
    // Four games still do; Fifty-One docks its own cluster too since Stage 38.0.4.
    expect((online.match(/renderSocial\([^)]*timerEl[,)]/g) ?? []).length).toBe(4);
    expect(online).not.toMatch(/renderSocial\([^)]*PokerActionLog/);
  });

  it('local poker uses the same in-flow row instead of a fixed corner cluster', () => {
    expect(local).toContain('socialSlot=');
    expect(local).toContain('room-social__bar');
    expect(local).not.toContain('poker-local-utility');
  });

  it('RoomSocial stays game-agnostic (slots only, no poker import/usage)', () => {
    expect(social).not.toMatch(/import[^;]*poker/i);
    expect(social).not.toContain('PokerActionLog');
    expect(social).toContain('{utilitySlot}');
    expect(social).toContain('utilityPanelSlot');
  });
});

describe('mobile ergonomics are pinned in CSS', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/social.css'), 'utf8');
  const pokerCss = readFileSync(join(process.cwd(), 'src/styles/poker.css'), 'utf8');

  it('the cluster has no fixed positioning at all', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = code.slice(code.indexOf('.room-social {'), code.indexOf('.room-social__bar {'));
    expect(rule).not.toContain('position:');
    expect(code).not.toContain('.social-controls');
  });

  it('the control row scrolls horizontally instead of the page', () => {
    expect(css).toMatch(/\.room-social__bar\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('safe-area inset is honoured at the bottom of the cluster', () => {
    expect(css).toMatch(/\.room-social\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  });

  it('every control keeps a 44px tap target', () => {
    expect(css).toMatch(/\.room-social__bar \.social-fab\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(pokerCss).toMatch(/\.poker-log-panel__head \.btn\s*\{[^}]*min-height:\s*44px/);
    // …and so does every control inside the shared chat panel (38.0.13/38.0.14).
    expect(css).toMatch(/\.chat-panel button\s*\{[^}]*min-height:\s*44px/);
  });

  it('the docked history panel is in flow, not anchored over the controls', () => {
    expect(pokerCss).toMatch(/\.poker-log-panel--docked\s*\{[^}]*position:\s*static/);
  });
});
