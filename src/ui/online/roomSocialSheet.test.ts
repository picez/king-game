// ---------------------------------------------------------------------------
// Stage 38.0.5.1 — the generic `sheet` LAUNCHER layout of RoomSocial.
//
// The owner's FAIL was that the docked toolbar (38.0.3/38.0.4) still ate a horizontal
// band of the phone between the game content and the prompt. `sheet` collapses ALL of
// it into compact launchers. RoomSocial must stay game-agnostic while doing it, and
// every other game's layout must be untouched.
//
// (Stage 38.0.13) The sheet no longer OWNS the chat: 💬 opens the shared `chat-dialog`,
// the same one the floating and docked variants open, and the ☰ sheet keeps only what is
// NOT chat — voice, the caller's utility panel and the destructive action. The one-chat
// contract itself is pinned in `roomSocialUnified.test.ts`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import RoomSocial from './RoomSocial';
import { LangProvider } from '../../i18n';
import type { ChatMessage } from '../../net/messages';

const chat = (n: number): ChatMessage[] => Array.from({ length: n }, (_, i) => ({
  id: `m${i}`, clientId: `peer-${i % 2}`, name: `P${i}`, avatar: '🙂',
  text: `msg ${i}`, createdAt: 1_700_000_000_000 + i, seatIndex: i % 3,
} as ChatMessage));

const noop = () => {};
function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(RoomSocial, {
    reactions: [], chat: [], myClientId: 'me',
    onReact: noop, onChat: noop, onChatMedia: noop,
    notice: null, onClearNotice: noop,
    ...props,
  } as never)));
}

describe('collapsed: compact launchers, no toolbar, no panel', () => {
  // 51's real props: a voice control and the destructive action, which is what the ☰ menu
  // exists to hold now that the chat dialog is chat and nothing else.
  const out = render({
    variant: 'sheet', openPanel: 'none', onPanelChange: noop,
    voiceButton: createElement('button', { className: 'probe-voice' }, 'v'),
    dangerSlot: createElement('button', { className: 'probe-danger' }, 'q'),
  });

  it('renders two compact launchers (💬 chat, ☰ menu) and no toolbar', () => {
    expect(out).toContain('social-menu__launcher');
    // (38.0.13) 💬 opens the SHARED chat dialog; ☰ opens this variant's own menu sheet.
    expect((out.match(/social-menu__launcher/g) ?? []).length).toBe(2);
    expect((out.match(/💬/g) ?? []).length).toBe(1);
    expect(out).not.toContain('social-controls');
    expect(out).not.toContain('social-controls__row');
  });

  it('with nothing to put in the menu there is only the chat launcher', () => {
    const bare = render({ variant: 'sheet', openPanel: 'none', onPanelChange: noop });
    expect((bare.match(/social-menu__launcher/g) ?? []).length).toBe(1);
    expect(bare).toContain('💬');
    expect(bare).not.toContain('☰');
  });

  it('no sheet, no backdrop, no chat dialog, no reaction bar', () => {
    expect(out).not.toContain('social-sheet');
    expect(out).not.toContain('social-sheet-backdrop');
    expect(out).not.toContain('chat-dialog');
    expect(out).not.toContain('reaction-bar');
  });

  it('the launcher announces itself as a dialog trigger', () => {
    expect(out).toMatch(/aria-haspopup="dialog"/);
    expect(out).toMatch(/aria-expanded="false"/);
  });

  it('the unread badge rides on the launcher', () => {
    const unread = render({ variant: 'sheet', openPanel: 'none', onPanelChange: noop, chat: chat(4) });
    expect(unread).toContain('social-fab__badge');
    expect(unread).toContain('>4<');
    const capped = render({ variant: 'sheet', openPanel: 'none', onPanelChange: noop, chat: chat(15) });
    expect(capped).toContain('9+');
  });

  it('no badge when there is nothing unread', () => {
    expect(out).not.toContain('social-fab__badge');
  });
});

describe('open: the ☰ menu is a real modal; 💬 opens the SHARED chat dialog', () => {
  const common = {
    variant: 'sheet' as const, onPanelChange: noop, chat: chat(6),
    voiceButton: createElement('button', { className: 'probe-voice' }, 'v'),
    dangerSlot: createElement('button', { className: 'probe-danger' }, 'q'),
  };
  const chatSheet = render({ ...common, openPanel: 'chat' });
  const menuSheet = render({ ...common, openPanel: 'utility' });

  it('the chat opens the shared dialog — not a sheet-only chat', () => {
    expect(chatSheet).toContain('chat-dialog-backdrop');
    expect(chatSheet).toContain('role="dialog"');
    expect(chatSheet).toContain('aria-modal="true"');
    expect(chatSheet).toContain('chat-dialog__close');
    expect(chatSheet).toContain('chat-dialog__list');
    expect(chatSheet).toContain('chat-dialog__compose');
    expect((chatSheet.match(/chat-msg /g) ?? []).length).toBe(6);
    // The sheet surface is not involved in chat any more.
    expect(chatSheet).not.toContain('social-sheet-backdrop');
  });

  it('voice and the destructive action live in the ☰ MENU footer', () => {
    expect(menuSheet).toContain('social-sheet-backdrop');
    expect(menuSheet).toContain('social-sheet__close');
    const foot = menuSheet.slice(menuSheet.indexOf('social-sheet__foot'));
    expect(foot).toContain('probe-voice');
    expect(foot).toContain('probe-danger');
    // …and the menu never renders a second chat.
    expect(menuSheet).not.toContain('chat-dialog');
  });

  it('emoji and stickers are opened from INSIDE the chat, never as a rival surface', () => {
    // (38.0.12) The composer owns the ONE picker button; there is no rival surface.
    expect(chatSheet).toContain('chat-picker-btn');
    expect(chatSheet).not.toContain('reaction-bar--sheet');
  });

  it('each surface heads itself — there is no tab strip', () => {
    expect(chatSheet).not.toContain('role="tab"');
    const chatTitle = chatSheet.slice(chatSheet.indexOf('chat-dialog__title'), chatSheet.indexOf('chat-dialog__close'));
    expect(chatTitle).toContain('💬');
    const menuTitle = menuSheet.slice(menuSheet.indexOf('social-sheet__title'), menuSheet.indexOf('social-sheet__close'));
    expect(menuTitle).toContain('☰');
  });

  it('the two surfaces are mutually exclusive', () => {
    expect((chatSheet.match(/class="chat-dialog"/g) ?? []).length).toBe(1);
    expect((menuSheet.match(/class="social-sheet"/g) ?? []).length).toBe(1);
  });
});

describe('the source contract that makes the sheet safe', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/online/RoomSocial.tsx'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'src/styles/social.css'), 'utf8');

  it('Escape and the backdrop both close it, and focus returns to the launcher', () => {
    // (38.0.12) Focus goes back to the launcher of the section that was open.
    expect(src).toMatch(/const opener = launcherFor\(panel\)\.current;/);
    expect(src).toMatch(/setPanel\('none'\);[\s\S]{0,40}opener\?\.focus\(\);/);
    expect(src).toContain('className="social-sheet-backdrop" role="presentation" onClick={closeChat}');
    expect(src).toContain('className="social-sheet__close" onClick={closeChat}');
    expect(src).toContain('className="chat-dialog-backdrop" role="presentation" onClick={closeChat}');
  });

  it('both surfaces are bounded and scroll inside themselves — the page never does', () => {
    const rule = css.slice(css.indexOf('.social-sheet {'), css.indexOf('.social-sheet__head'));
    expect(rule).toMatch(/max-height: min\(80vh, 34rem\)/);
    const dialog = css.slice(css.indexOf('.chat-dialog {'));
    expect(dialog.slice(0, dialog.indexOf('}'))).toMatch(/max-height: min\(80vh, 34rem\)/);
    const list = css.slice(css.indexOf('.chat-dialog__list {'));
    expect(list.slice(0, list.indexOf('}'))).toMatch(/overflow-y: auto/);
  });

  it('the collapsed launcher is in flow and a real tap target', () => {
    expect(css).toMatch(/\.social-menu \{[^}]*display: inline-flex/);
    expect(css).not.toMatch(/\.social-menu \{[^}]*position: (fixed|absolute)/);
    expect(css).toMatch(/\.social-menu__launcher \{[^}]*min-width: 44px[^}]*min-height: 44px/);
  });

  it('RoomSocial has no game DEPENDENCY (comments may explain who uses what)', () => {
    // Strip comments: a doc comment naming which game picks which variant is fine —
    // an import, a type or a runtime branch on a game is not.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/poker|fifty-?one|durak|deberc|tarneeb|preferans/i);
    expect(code).not.toMatch(/gameType/);
  });

  it('the floating and docked variants still exist and are unchanged in shape', () => {
    const floating = render({ chat: chat(2) });
    expect(floating).toContain('social-controls');
    expect(floating).not.toContain('social-controls--docked');
    expect(floating).not.toContain('social-menu__launcher');
    const docked = render({ variant: 'docked', chat: chat(2) });
    expect(docked).toContain('social-controls--docked');
    expect(docked).not.toContain('social-menu__launcher');
  });
});
