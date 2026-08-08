// ---------------------------------------------------------------------------
// Stage 38.0.12 — the two owner FAILs on the room sheet.
//
//  A. TWO scrollbars: the sheet body scrolled AND the grids inside it kept their own.
//  B. Emoji/stickers were a separate surface layered over the chat. They are now a
//     picker INSIDE the chat, opened from the composer, so a player can keep reading,
//     typing and sending while it is open — emoji TYPE into the message, stickers send.
//
// The vitest env is `node` (no jsdom), so structure is proved by SSR markup + source
// and CSS contracts; the real geometry and the real clicks are measured by
// `npm run layout:fiftyone`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomSocial, { type SocialPanel } from './RoomSocial';
import { LangProvider } from '../../i18n';
import type { ChatMessage } from '../../net/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const noop = () => {};

const chat: ChatMessage[] = [{
  id: 'm1', clientId: 'other', name: 'Kai', avatar: '🙂',
  text: 'hello', createdAt: 1_700_000_000_000, seatIndex: 1,
} as ChatMessage];

function sheet(openPanel: SocialPanel): string {
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(RoomSocial, {
    reactions: [], chat, myClientId: 'me',
    onReact: noop, onChat: noop, onChatMedia: noop,
    notice: null, onClearNotice: noop,
    variant: 'sheet', openPanel, onPanelChange: noop,
  })));
}

describe('FAIL B — emoji and stickers live inside the chat', () => {
  const src = read('src/ui/online/RoomSocial.tsx');

  it('the collapsed menu is just the chat launcher', () => {
    const html = sheet('none');
    expect(html).toContain('💬');
    expect((html.match(/social-menu__launcher/g) ?? []).length).toBe(1);
    expect(html).not.toContain('social-sheet');
  });

  it('the sheet has no tab strip and no reaction surface of its own', () => {
    const html = sheet('chat');
    expect(html).toContain('social-sheet__title');
    expect(html).not.toContain('social-sheet__tab');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('reaction-bar--sheet');
    expect(src).not.toContain('social-sheet__tabs');
  });

  it('the composer carries BOTH picker buttons, and the picker starts closed', () => {
    const html = sheet('chat');
    expect(html).toContain('chat-emoji-btn');           // 😀
    expect(html).toContain('chat-media-btn');           // 🖼️
    expect(html).toContain('chat-drawer__list');        // the conversation is still there
    expect(html).not.toContain('chat-picker');          // …until a button opens it
    // Both buttons drive the same in-chat picker.
    expect((src.match(/onClick=\{\(\) => setMediaOpen\(\(o\) => !o\)\}/g) ?? []).length).toBe(2);
  });

  it('an emoji TYPES into the message; it does not fire a table reaction', () => {
    expect(src).toMatch(/onClick=\{\(\) => insertEmoji\(e\)\}/);
    expect(src).toContain('setText((prev) => (prev + emoji).slice(0, MAX_CHAT_LEN));');
    expect(src).toContain('inputRef.current?.focus();');
    // The picker's own grid never calls react().
    const picker = src.slice(src.indexOf('const chatPicker = mediaOpen'), src.indexOf('return ('));
    expect(picker).not.toContain('react(');
    // The floating/docked clusters keep sending a reaction from their bar.
    expect(src).toMatch(/const emojiGrid = \([\s\S]*?onClick=\{\(\) => react\(e\)\}/);
  });

  it('sending from the sheet leaves the chat AND the picker open', () => {
    expect(src).toMatch(/function sendMedia\(item: ChatMediaItem\) \{\s*onChatMedia\(item\.id\);\s*if \(!sheet\) \{ setMediaOpen\(false\); setReactOpen\(false\); \}/);
    expect((src.match(/setPanel\('none'\)/g) ?? []).length).toBe(1);   // inside closeSheet only
  });

  it('only the deliberate gestures close the sheet, focus returns to its launcher', () => {
    expect(src).toContain('className="social-sheet-backdrop" role="presentation" onClick={closeSheet}');
    expect(src).toContain('className="social-sheet__close" onClick={closeSheet}');
    expect(src).toMatch(/if \(sheetOpen\) \{ closeSheet\(\); return; \}/);
    expect(src).toMatch(/onClick=\{\(\) => \(chatOpen \? closeSheet\(\) : setPanel\('chat'\)\)\}/);
    expect(src).toContain("const opener = launcherFor(panel).current; setPanel('none'); opener?.focus();");
  });
});

describe('FAIL A — one scroller per region', () => {
  const css = read('src/styles/social.css');
  const src = read('src/ui/online/RoomSocial.tsx');

  it('the conversation scrolls in the body, and nothing inside it scrolls too', () => {
    const body = css.slice(css.indexOf('.social-sheet__body {'));
    expect(body.slice(0, body.indexOf('}'))).toContain('overflow-y: auto');
    const list = css.slice(css.indexOf('.social-sheet__body .chat-drawer__list {'));
    expect(list.slice(0, list.indexOf('}'))).toContain('overflow: visible');
    // …so the auto-scroll targets the real scroller.
    expect(src).toContain("const scroller = list.closest('.social-sheet__body') ?? list;");
  });

  it('the picker bounds itself and its grid does not add a second scrollbar', () => {
    const picker = css.slice(css.indexOf('.chat-picker {'));
    const rule = picker.slice(0, picker.indexOf('}'));
    expect(rule).toContain('max-height: 34vh');
    expect(rule).toContain('overflow-y: auto');
    expect(css).toMatch(/\.chat-picker \.reaction-bar__stickers \{[^}]*max-height: none[^}]*overflow: visible/);
    // The floating/docked clusters keep their own bounded, scrolling grid.
    const grid = css.slice(css.indexOf('.reaction-bar__stickers {'), css.indexOf('.reaction-bar__stickers::'));
    expect(grid).toContain('max-height: 38vh');
    expect(grid).toContain('overflow-y: auto');
  });

  it('composer and picker are pinned OUTSIDE the scroller, picker below the composer', () => {
    const body = src.slice(src.indexOf('<div className="social-sheet__body">'));
    expect(body.slice(0, body.indexOf('</div>'))).not.toContain('chatCompose');
    expect(src).toMatch(/\{chatOpen && chatCompose\}\s*\{chatOpen && chatPicker\}/);
    const pinned = css.slice(css.indexOf('.social-sheet > .chat-drawer__compose {'));
    expect(pinned.slice(0, pinned.indexOf('}'))).toContain('flex: 0 0 auto');
  });
});
