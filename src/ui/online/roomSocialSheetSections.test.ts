// ---------------------------------------------------------------------------
// Stage 38.0.12 — the two owner FAILs on the room sheet.
//
//  A. TWO scrollbars: the sheet body scrolls AND the sticker grid inside it kept its
//     own `max-height: 38vh; overflow-y: auto`, so a phone showed nested scrollers.
//  B. Reactions sat ON TOP OF the chat as a tab of the same surface. They are now
//     their own section behind their own launcher.
//
// The vitest env is `node` (no jsdom), so structure is proved by SSR markup + source
// and CSS contracts; the real geometry is measured by `npm run layout:fiftyone`.
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

describe('FAIL B — reactions are their own section, not a layer over the chat', () => {
  const src = read('src/ui/online/RoomSocial.tsx');

  it('the collapsed menu offers one launcher per section', () => {
    const html = sheet('none');
    expect(html).toContain('😀');
    expect(html).toContain('💬');
    expect((html.match(/social-menu__launcher/g) ?? []).length).toBe(2); // no utilitySlot here
    expect(html).not.toContain('social-sheet');                          // nothing open yet
  });

  it('the sheet has NO tab strip any more — it shows the section it was opened for', () => {
    for (const panel of ['reactions', 'chat'] as const) {
      const html = sheet(panel);
      expect(html, panel).toContain('social-sheet__title');
      expect(html, panel).not.toContain('social-sheet__tab');
      expect(html, panel).not.toContain('role="tablist"');
    }
    expect(src).not.toContain('social-sheet__tabs');
  });

  it('the reactions section carries the pickers and NOT the chat', () => {
    const html = sheet('reactions');
    expect(html).toContain('reaction-bar--sheet');
    expect(html).toContain('reaction-bar__stickers');
    expect(html).not.toContain('chat-drawer__list');
    expect(html).not.toContain('chat-drawer__compose');
  });

  it('the chat section carries the conversation and NOT the reaction pickers', () => {
    const html = sheet('chat');
    expect(html).toContain('chat-drawer__list');
    expect(html).toContain('chat-drawer__compose');
    expect(html).not.toContain('reaction-bar--sheet');
    expect(html).not.toContain('reaction-bar__emojis');
  });

  it('each launcher toggles only its own section, and focus returns to that launcher', () => {
    expect(src).toMatch(/onClick=\{\(\) => \(reactOpen \? closeSheet\(\) : setPanel\('reactions'\)\)\}/);
    expect(src).toMatch(/onClick=\{\(\) => \(chatOpen \? closeSheet\(\) : setPanel\('chat'\)\)\}/);
    expect(src).toContain('const opener = launcherFor(panel).current; setPanel(\'none\'); opener?.focus();');
    // Still exactly one place that clears the panel.
    expect((src.match(/setPanel\('none'\)/g) ?? []).length).toBe(1);
  });

  it('sending from the sheet still never closes it (Stage 38.0.9 stands)', () => {
    expect(src).toMatch(/function react\(emoji: string\) \{\s*onReact\(emoji\);\s*if \(!sheet\) setReactOpen\(false\);/);
    expect(src).toMatch(/function sendMedia\(item: ChatMediaItem\) \{\s*onChatMedia\(item\.id\);\s*setMediaOpen\(false\);\s*if \(!sheet\) setReactOpen\(false\);/);
  });
});

describe('FAIL A — the sheet has exactly one scrolling region', () => {
  const css = read('src/styles/social.css');
  const src = read('src/ui/online/RoomSocial.tsx');

  it('the body is the scroller', () => {
    const body = css.slice(css.indexOf('.social-sheet__body {'));
    expect(body.slice(0, body.indexOf('}'))).toContain('overflow-y: auto');
  });

  it('the message list is scrolled BY the body, not by itself', () => {
    const rule = css.slice(css.indexOf('.social-sheet__body .chat-drawer__list {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('overflow: visible');
    // …so the auto-scroll targets the real scroller.
    expect(src).toContain("const scroller = list.closest('.social-sheet__body') ?? list;");
    expect(src).toContain('scroller.scrollTo({ top: scroller.scrollHeight });');
  });

  it('neither media grid scrolls on its own inside the sheet', () => {
    const rule = css.slice(
      css.indexOf('.social-sheet__body .reaction-bar__stickers,'),
      css.indexOf('.reaction-bar--sheet {'),
    );
    expect(rule).toContain('.social-sheet__body .chat-media-picker');
    expect(rule).toContain('max-height: none');
    expect(rule).toContain('overflow: visible');
    // The floating/docked clusters keep their own bounded, scrolling grids.
    const grid = css.slice(css.indexOf('.reaction-bar__stickers {'), css.indexOf('.reaction-bar__stickers::'));
    expect(grid).toContain('max-height: 38vh');
    expect(grid).toContain('overflow-y: auto');
  });

  it('the composer is pinned outside the scroller so the sticker grid cannot bury it', () => {
    const body = src.slice(src.indexOf('<div className="social-sheet__body">'));
    const bodyEnd = body.indexOf('</div>');
    expect(body.slice(0, bodyEnd)).not.toContain('chatCompose');
    expect(src).toContain('{chatOpen && chatCompose}');
    const pinned = css.slice(css.indexOf('.social-sheet > .chat-drawer__compose {'));
    expect(pinned.slice(0, pinned.indexOf('}'))).toContain('flex: 0 0 auto');
    // …and the picker it opens below the conversation is scrolled into view.
    expect(src).toMatch(/if \(!mediaOpen\) return;[\s\S]{0,200}scroller\?\.scrollTo/);
  });
});
