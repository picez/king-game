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

describe('RoomSocial docked variant', () => {
  it('docked renders a static cluster, never the fixed "raised" overlay', () => {
    const out = html(createElement(RoomSocial, { ...socialProps, variant: 'docked', handVisible: true }));
    expect(out).toContain('social-controls--docked');
    expect(out).not.toContain('social-controls--raised');
  });

  it('floating (every other game) is untouched', () => {
    const out = html(createElement(RoomSocial, { ...socialProps, handVisible: true }));
    expect(out).toContain('social-controls');
    expect(out).not.toContain('social-controls--docked');
    expect(out).toContain('social-controls--raised');
  });

  it('the docked chat panel is in flow, not the fixed side drawer', () => {
    const out = html(createElement(RoomSocial, { ...socialProps, variant: 'docked', openPanel: 'chat' }));
    expect(out).toContain('chat-drawer--docked');
  });
});

describe('exactly one social surface is open at a time', () => {
  const render = (openPanel: 'none' | 'reactions' | 'chat' | 'utility') => html(createElement(RoomSocial, {
    ...socialProps, variant: 'docked', openPanel,
    utilitySlot: createElement(PokerActionLogButton, { open: openPanel === 'utility', unread: false, onToggle: () => {} }),
    utilityPanelSlot: openPanel === 'utility'
      ? createElement(PokerActionLogPanel, { state: betting(), docked: true, onClose: () => {} })
      : null,
  }));

  it('default closed: no chat, no reactions, no history panel', () => {
    const out = render('none');
    expect(out).not.toContain('chat-drawer');
    expect(out).not.toContain('reaction-bar');
    expect(out).not.toContain('poker-log-panel');
  });

  it('chat open → neither the reaction bar nor the history panel is rendered', () => {
    const out = render('chat');
    expect(out).toContain('chat-drawer');
    expect(out).not.toContain('reaction-bar');
    expect(out).not.toContain('poker-log-panel');
  });

  it('history open → neither chat nor the reaction bar is rendered', () => {
    const out = render('utility');
    expect(out).toContain('poker-log-panel');
    expect(out).not.toContain('chat-drawer');
    expect(out).not.toContain('reaction-bar');
  });

  it('reactions open → neither chat nor history is rendered', () => {
    const out = render('reactions');
    expect(out).toContain('reaction-bar');
    expect(out).not.toContain('chat-drawer');
    expect(out).not.toContain('poker-log-panel');
  });
});

describe('wiring', () => {
  const online = readFileSync(join(process.cwd(), 'src/ui/online/OnlineGame.tsx'), 'utf8');
  const local = readFileSync(join(process.cwd(), 'src/ui/poker/PokerLocalGame.tsx'), 'utf8');
  const social = readFileSync(join(process.cwd(), 'src/ui/online/RoomSocial.tsx'), 'utf8');

  it('the poker branch docks the cluster and owns the open panel', () => {
    expect(online).toContain('variant="docked"');
    expect(online).toContain('openPanel={socialPanel}');
    expect(online).toContain('onPanelChange={setSocialPanel}');
    expect(online).toContain('socialSlot={social}');
  });

  it('poker no longer mounts the floating cluster via renderSocial', () => {
    // Four games still do; Fifty-One docks its own cluster too since Stage 38.0.4.
    expect((online.match(/renderSocial\([^)]*timerEl[,)]/g) ?? []).length).toBe(4);
    expect(online).not.toMatch(/renderSocial\([^)]*PokerActionLog/);
  });

  it('local poker docks the same control instead of a fixed corner cluster', () => {
    expect(local).toContain('socialSlot=');
    expect(local).toContain('social-controls--docked');
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

  it('the docked cluster leaves the fixed positioning behind', () => {
    expect(css).toMatch(/\.social-controls--docked\s*\{[^}]*position:\s*static/);
  });

  it('the toolbar row scrolls horizontally instead of the page', () => {
    expect(css).toMatch(/\.social-controls--docked \.social-controls__row\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('safe-area inset is honoured at the bottom of the dock', () => {
    expect(css).toMatch(/\.social-controls--docked\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  });

  it('every docked control keeps a 44px tap target', () => {
    expect(css).toMatch(/\.social-controls--docked \.social-fab\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(pokerCss).toMatch(/\.poker-log-panel__head \.btn[\s\S]{0,120}min-height:\s*44px/);
  });

  it('the docked history panel is in flow, not anchored over the controls', () => {
    expect(pokerCss).toMatch(/\.poker-log-panel--docked\s*\{[^}]*position:\s*static/);
  });
});
