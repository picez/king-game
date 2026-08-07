// ---------------------------------------------------------------------------
// Stage 38.0.5.1 — the generic `sheet` layout variant of RoomSocial.
//
// The owner's FAIL was that the docked toolbar (38.0.3/38.0.4) still ate a horizontal
// band of the phone between the game content and the prompt. `sheet` collapses ALL of
// it into ONE launcher plus a modal surface. RoomSocial must stay game-agnostic while
// doing it, and every other game's layout must be untouched.
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

describe('collapsed: ONE launcher, no toolbar, no panel', () => {
  const out = render({ variant: 'sheet', openPanel: 'none', onPanelChange: noop });

  it('renders a single launcher and nothing else interactive', () => {
    expect(out).toContain('social-menu__launcher');
    expect((out.match(/social-menu__launcher/g) ?? []).length).toBe(1);
    expect(out).not.toContain('social-controls');
    expect(out).not.toContain('social-controls__row');
  });

  it('no sheet, no backdrop, no chat drawer, no reaction bar', () => {
    expect(out).not.toContain('social-sheet');
    expect(out).not.toContain('social-sheet-backdrop');
    expect(out).not.toContain('chat-drawer');
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

describe('open: a real modal sheet with backdrop, close and its own scroll', () => {
  const chatSheet = render({
    variant: 'sheet', openPanel: 'chat', onPanelChange: noop, chat: chat(6),
    voiceButton: createElement('button', { className: 'probe-voice' }, 'v'),
    dangerSlot: createElement('button', { className: 'probe-danger' }, 'q'),
  });

  it('the chat sheet holds the message list and the composer', () => {
    expect(chatSheet).toContain('social-sheet-backdrop');
    expect(chatSheet).toContain('role="dialog"');
    expect(chatSheet).toContain('aria-modal="true"');
    expect(chatSheet).toContain('social-sheet__close');
    expect(chatSheet).toContain('social-sheet__body');
    expect(chatSheet).toContain('chat-drawer__list');
    expect(chatSheet).toContain('chat-drawer__compose');
    expect((chatSheet.match(/chat-msg /g) ?? []).length).toBe(6);
  });

  it('voice and the destructive action live in the sheet footer', () => {
    expect(chatSheet).toContain('probe-voice');
    expect(chatSheet).toContain('probe-danger');
    const foot = chatSheet.slice(chatSheet.indexOf('social-sheet__foot'));
    expect(foot).toContain('probe-voice');
    expect(foot).toContain('probe-danger');
  });

  it('reactions open as the SAME single surface — never stacked with chat', () => {
    const react = render({ variant: 'sheet', openPanel: 'reactions', onPanelChange: noop, chat: chat(6) });
    expect(react).toContain('reaction-bar--sheet');
    expect(react).toContain('reaction-bar__emojis');
    expect(react).not.toContain('chat-drawer__compose');
    expect((react.match(/social-sheet"/g) ?? []).length).toBe(1);
    // …and the chat sheet does not render the reaction grid.
    expect(chatSheet).not.toContain('reaction-bar--sheet');
  });

  it('the tabs report which surface is showing', () => {
    expect(chatSheet).toMatch(/role="tab" aria-selected="true"/);
    expect((chatSheet.match(/role="tab"/g) ?? []).length).toBe(2);
  });

  it('a floating chat drawer is NOT also rendered in sheet mode', () => {
    // The drawer only ever exists once, inside the sheet body.
    expect((chatSheet.match(/class="chat-drawer[ "]/g) ?? []).length).toBe(0);
  });
});

describe('the source contract that makes the sheet safe', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/online/RoomSocial.tsx'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'src/styles/social.css'), 'utf8');

  it('Escape and the backdrop both close it, and focus returns to the launcher', () => {
    expect(src).toMatch(/const closeSheet = \(\) => \{ setPanel\('none'\); launcherRef\.current\?\.focus\(\); \}/);
    expect(src).toMatch(/if \(sheetOpen\) \{ closeSheet\(\); return; \}/);
    expect(src).toContain('className="social-sheet-backdrop" role="presentation" onClick={closeSheet}');
    expect(src).toContain('className="social-sheet__close" onClick={closeSheet}');
  });

  it('the sheet is bounded and scrolls itself — the page never does', () => {
    const rule = css.slice(css.indexOf('.social-sheet {'), css.indexOf('.social-sheet__head'));
    expect(rule).toMatch(/max-height: min\(80vh, 34rem\)/);
    const body = css.slice(css.indexOf('.social-sheet__body {'));
    expect(body.slice(0, body.indexOf('}'))).toMatch(/overflow-y: auto/);
    expect(body.slice(0, body.indexOf('}'))).toMatch(/overflow-x: hidden/);
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
