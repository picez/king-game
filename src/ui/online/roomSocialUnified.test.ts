// ---------------------------------------------------------------------------
// Stage 38.0.12 (unification) — ONE social contract for all seven online games.
//
// The owner FAIL: after 38.0.12.1 Fifty-One had a different chat model from the other
// six games. 51 got a messenger-style in-chat picker whose emoji TYPE into the message
// and lost any way to send a table reaction; the other six kept a separate 😀 control
// whose emoji only send a reaction and whose chat had no emoji at all. Two products.
//
// The contract asserted here (identical for `floating`, `docked` and `sheet`):
//   * exactly ONE outer social surface for chat — no separate reactions button;
//   * the open chat always shows history + a composer + a picker button + Send;
//   * the picker is a bounded sibling of the history, never a replacement for it;
//   * emoji carry TWO EXPLICIT actions chosen by a visible mode switch —
//     "to message" (insert at the caret) and "to table" (the existing server
//     reaction, anchored on the sender's SEAT);
//   * nothing in the send paths closes the chat or the picker.
//
// Geometry and the real clicks are measured in a browser by `npm run layout:social`
// (all variants) and `npm run layout:fiftyone` (51's sheet in its real screen).
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
const src = read('src/ui/online/RoomSocial.tsx');
const css = read('src/styles/social.css');
const noop = () => {};

const chat: ChatMessage[] = Array.from({ length: 4 }, (_, i) => ({
  id: `m${i}`, clientId: i % 2 ? 'me' : 'other', name: 'Kai', avatar: '🙂',
  text: `msg ${i}`, createdAt: 1_700_000_000_000 + i, seatIndex: i % 2,
} as ChatMessage));

type Variant = 'floating' | 'docked' | 'sheet';
const VARIANTS: Variant[] = ['floating', 'docked', 'sheet'];

function render(variant: Variant, openPanel: SocialPanel, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(RoomSocial, {
    reactions: [], chat, myClientId: 'me',
    onReact: noop, onChat: noop, onChatMedia: noop,
    notice: null, onClearNotice: noop,
    variant, openPanel, onPanelChange: noop,
    ...extra,
  } as never)));
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('one social contract for every game', () => {
  it('offers exactly ONE outer chat control and NO separate reactions control', () => {
    for (const variant of VARIANTS) {
      const collapsed = render(variant, 'none');
      expect(count(collapsed, /aria-label="[^"]*"[^>]*>\s*💬/g) + count(collapsed, /💬/g), variant)
        .toBeGreaterThanOrEqual(1);
      // The historical 😀 control that opened a rival reaction surface is gone.
      expect(collapsed, variant).not.toContain('social.reactions');
      expect(collapsed.includes('>😀<'), `${variant} still has a standalone reactions button`).toBe(false);
    }
    // …and no panel value for it survives in the model.
    expect(src).toContain("export type SocialPanel = 'none' | 'chat' | 'utility';");
    expect(src).not.toMatch(/setPanel\('reactions'\)/);
  });

  it('renders the SAME chat structure in every variant', () => {
    for (const variant of VARIANTS) {
      const open = render(variant, 'chat');
      expect(count(open, /class="chat-drawer__list"/g), `${variant} history`).toBe(1);
      expect(count(open, /class="chat-drawer__compose"/g), `${variant} composer`).toBe(1);
      expect(count(open, /chat-picker-btn/g), `${variant} picker button`).toBe(1);
      expect(count(open, /class="input chat-input"/g), `${variant} text field`).toBe(1);
      expect(open, `${variant} send`).toContain('type="submit"');
      // No variant renders a second, rival copy of the picker or the chat.
      expect(count(open, /class="chat-media-picker"/g), `${variant} legacy picker`).toBe(0);
      expect(count(open, /reaction-bar--docked|reaction-bar--sheet/g), `${variant} rival bar`).toBe(0);
    }
  });

  it('the picker is defined ONCE and shared by every variant', () => {
    expect(count(src, /const chatPicker =/g)).toBe(1);
    expect(count(src, /const chatCompose =/g)).toBe(1);
    expect(count(src, /const chatList =/g)).toBe(1);
    // One shared body, rendered by the drawer AND the sheet.
    expect(count(src, /const chatPanel =/g)).toBe(1);
  });
});

describe('emoji carry two EXPLICIT actions', () => {
  it('the picker shows a visible mode switch — no ambiguous single tap', () => {
    expect(src).toContain("const [pickerMode, setPickerMode] = useState<PickerMode>('message');");
    expect(src).toMatch(/chat-picker__mode/);
    expect(src).toMatch(/aria-pressed=\{pickerMode === 'message'\}/);
    expect(src).toMatch(/aria-pressed=\{pickerMode === 'table'\}/);
    expect(src).toContain("t('chat.emojiToMessage')");
    expect(src).toContain("t('chat.emojiToTable')");
  });

  it('"to message" inserts at the CARET without wiping what is typed', () => {
    expect(src).toContain('const start = el?.selectionStart ?? text.length;');
    expect(src).toContain('const end = el?.selectionEnd ?? text.length;');
    expect(src).toMatch(/text\.slice\(0, start\) \+ emoji \+ text\.slice\(end\)/);
    expect(src).not.toMatch(/setText\(\(prev\) => \(prev \+ emoji\)/); // the old append-only
  });

  it('"to table" sends the EXISTING server reaction, once, and touches no text', () => {
    expect(src).toMatch(/function react\(emoji: string\) \{\s*onReact\(emoji\);\s*\}/);
    expect(src).toMatch(/pickerMode === 'message' \? insertEmoji\(e\) : react\(e\)/);
  });

  it('a table reaction is anchored on the sender SEAT, never on a display name', () => {
    expect(src).toContain('reactionAnchorForSender(r.seatIndex, mySeatIndex, seatCount, reactionsMirrored)');
    // Two players may share a name; the anchor must not depend on it.
    expect(src).not.toMatch(/reactionAnchorForSender\([^)]*\.name/);
  });
});

describe('nothing in the send paths closes the chat or the picker', () => {
  it('emoji, reaction and sticker sends leave both surfaces open', () => {
    expect(src).toMatch(/function sendMedia\(item: ChatMediaItem\) \{\s*onChatMedia\(item\.id\);\s*\}/);
    expect(src).not.toMatch(/onReact\(emoji\);\s*set(React|Picker)Open\(false\)/);
    expect(src).not.toMatch(/onChatMedia\(item\.id\);\s*setPickerOpen\(false\)/);
  });

  it('Escape closes the picker first, then the chat; ✕ closes the chat', () => {
    expect(src).toMatch(/if \(lightbox\) \{ setLightbox\(null\); return; \}/);
    expect(src).toMatch(/if \(pickerOpen\) \{ closePicker\(\); return; \}/);
    expect(src).toMatch(/closeChat\(\)/);
  });

  it('the picker button toggles ONLY the picker', () => {
    expect(src).toMatch(/onClick=\{\(\) => \(pickerOpen \? closePicker\(\) : setPickerOpen\(true\)\)\}/);
  });
});

describe('the picker is bounded, and the history survives beside it', () => {
  it('the picker has its own capped height and a single scroll', () => {
    const rule = css.slice(css.indexOf('.chat-picker {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/max-height: min\(30vh, 210px\)/);
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('overflow-x: hidden');
    // …and nothing inside it scrolls too.
    expect(css).toMatch(/\.chat-picker \.reaction-bar__stickers \{[^}]*max-height: none[^}]*overflow: visible/);
  });

  it('the history keeps a floor so the picker can never squeeze it away', () => {
    expect(css).toMatch(/\.chat-drawer__list \{[^}]*min-height: 6\.5rem/);
    // …and it shrinks the PICKER, not the history, when the panel is short.
    expect(css).toMatch(/\.chat-picker \{[^}]*flex: 0 1 auto[^}]*min-height: 0/);
  });

  it('the sticker cells stay square with a fully visible image', () => {
    const cell = css.slice(css.indexOf('.chat-media-thumb {'), css.indexOf('.chat-media-thumb:hover'));
    expect(cell).toContain('aspect-ratio: 1 / 1');
    const img = css.slice(css.indexOf('.chat-media-thumb img {'));
    const rule = img.slice(0, img.indexOf('}'));
    expect(rule).toContain('object-fit: contain');
    expect(rule).toContain('width: 100%');
  });
});

describe('what must NOT change', () => {
  it('the utility slot still rides next to chat and owns its own panel', () => {
    const util = render('docked', 'utility', {
      utilitySlot: createElement('button', { className: 'probe-util' }, 'u'),
      utilityPanelSlot: createElement('div', { className: 'probe-util-panel' }),
    });
    expect(util).toContain('probe-util');
    expect(util).toContain('probe-util-panel');
  });

  it('RoomSocial still knows nothing about any game', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/poker|fifty-?one|durak|deberc|tarneeb|preferans/i);
    expect(code).not.toMatch(/gameType/);
  });

  it('the sticker catalog is used whole — never sliced or rebuilt here', () => {
    expect(src).toContain('CHAT_MEDIA.map((item)');
    expect(src).not.toMatch(/CHAT_MEDIA\.(slice|filter|sort)/);
  });
});
