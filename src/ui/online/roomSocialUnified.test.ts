// ---------------------------------------------------------------------------
// Stage 38.0.13 — ONE chat dialog for all seven online games, and an emoji action
// chosen by FOCUS instead of by a manual switch.
//
// The owner FAIL. Stage 38.0.12 claimed "one social contract" after unifying what was
// INSIDE the chat, and the tests below pinned exactly that — history, composer, picker.
// The SHELL was still picked by `variant`, so production still showed three different
// chats. Measured at 75a3b6d by `npm run layout:social`, 390px wide:
//
//   durak     .chat-drawer   320x844 @70,0    radius 0px                backdrop none
//   fiftyone  .social-sheet  390x544 @0,300   radius 16px 16px 0px 0px  backdrop rgba(0,0,0,.62)
//   poker     .chat-drawer   371x400 @10,617  radius 11.2px             backdrop none
//
// …and the picker carried two buttons ("To message" / "To table") that asked the player
// to declare an intent their keyboard already declared.
//
// The contract asserted here:
//   * the chat dialog is declared ONCE and every variant renders the SAME markup;
//   * `variant` positions launchers only — it selects no chat shell;
//   * there is no PickerMode anywhere: not in the source, the markup, the CSS or i18n;
//   * an emoji tap reads the message field's FOCUS — never `text.length`;
//   * no picker control may take focus, or the tap would change its own meaning;
//   * a sticker is always chat media, and no send path closes anything.
//
// Geometry and the real focus-driven clicks are measured in a browser by
// `npm run layout:social` (three real online branches) — the vitest env has no DOM.
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

/** The chat dialog is the LAST thing RoomSocial renders — slice it off whole. */
function dialogOf(html: string): string {
  const at = html.indexOf('<div class="chat-dialog-backdrop"');
  return at === -1 ? '' : html.slice(at);
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('ONE chat dialog, whatever the game', () => {
  it('every variant renders the SAME dialog markup, byte for byte', () => {
    const dialogs = VARIANTS.map((v) => dialogOf(render(v, 'chat')));
    for (const [i, d] of dialogs.entries()) {
      expect(d, `${VARIANTS[i]} renders no chat dialog`).not.toBe('');
    }
    expect(dialogs[1], 'docked differs from floating').toBe(dialogs[0]);
    expect(dialogs[2], 'sheet differs from floating').toBe(dialogs[0]);
  });

  it('the dialog is a modal: a backdrop, one card, a "Chat" header, ✕', () => {
    for (const variant of VARIANTS) {
      const open = render(variant, 'chat');
      expect(count(open, /class="chat-dialog-backdrop"/g), `${variant} backdrop`).toBe(1);
      expect(count(open, /class="chat-dialog"/g), `${variant} card`).toBe(1);
      expect(count(open, /class="chat-dialog__title"/g), `${variant} title`).toBe(1);
      expect(count(open, /class="chat-dialog__close"/g), `${variant} close`).toBe(1);
      expect(open, `${variant} dialog role`).toMatch(/class="chat-dialog" role="dialog" aria-modal="true"/);
    }
  });

  it('renders the SAME chat parts in every variant, exactly once each', () => {
    for (const variant of VARIANTS) {
      const open = render(variant, 'chat');
      expect(count(open, /class="chat-dialog__list"/g), `${variant} history`).toBe(1);
      expect(count(open, /class="chat-dialog__compose"/g), `${variant} composer`).toBe(1);
      expect(count(open, /chat-picker-btn/g), `${variant} picker button`).toBe(1);
      expect(count(open, /class="input chat-input"/g), `${variant} text field`).toBe(1);
      expect(open, `${variant} send`).toContain('type="submit"');
    }
  });

  it('the historical per-variant shells are GONE from the markup and the CSS', () => {
    for (const variant of VARIANTS) {
      const open = render(variant, 'chat');
      expect(open, `${variant} still has a drawer`).not.toContain('chat-drawer');
      // The sheet's own surface survives ONLY for the ☰ menu, never for chat.
      expect(dialogOf(open), `${variant} chat is inside a sheet`).not.toContain('social-sheet');
    }
    expect(css, 'CSS still styles a chat drawer').not.toContain('.chat-drawer');
  });

  it('the dialog and its pieces are declared ONCE and shared', () => {
    expect(count(src, /const chatDialog =/g)).toBe(1);
    expect(count(src, /const chatPicker =/g)).toBe(1);
    expect(count(src, /const chatCompose =/g)).toBe(1);
    expect(count(src, /const chatList =/g)).toBe(1);
    expect(count(src, /\{chatDialog\}/g)).toBe(1);
  });

  it('`variant` no longer selects a chat shell — only where the buttons sit', () => {
    // No branch anywhere renders the chat conditionally on the layout mode.
    expect(src).not.toMatch(/(docked|sheet)\s*(\?|&&)[^\n]*chat-(drawer|dialog)/);
    expect(src).not.toMatch(/!sheet && chatOpen/);
  });
});

describe('exactly one outer social control for chat', () => {
  it('offers ONE chat launcher and NO separate reactions control', () => {
    for (const variant of VARIANTS) {
      const collapsed = render(variant, 'none');
      expect(count(collapsed, /💬/g), `${variant} chat controls`).toBe(1);
      expect(collapsed, variant).not.toContain('social.reactions');
      expect(collapsed.includes('>😀<'), `${variant} still has a standalone reactions button`).toBe(false);
    }
    expect(src).toContain("export type SocialPanel = 'none' | 'chat' | 'utility';");
    expect(src).not.toMatch(/setPanel\('reactions'\)/);
  });

  it('the sheet keeps a ☰ menu for what is NOT chat (voice / quit / utility)', () => {
    const menu = render('sheet', 'utility', {
      voiceButton: createElement('button', { className: 'probe-voice' }, 'v'),
      dangerSlot: createElement('button', { className: 'probe-danger' }, 'q'),
    });
    expect(menu).toContain('social-sheet__foot');
    expect(menu).toContain('probe-voice');
    expect(menu).toContain('probe-danger');
    // …and the menu is never a second chat.
    expect(menu).not.toContain('chat-dialog');
  });
});

describe('the emoji action is decided by FOCUS, not by a switch', () => {
  it('no PickerMode survives — source, markup, CSS or i18n', () => {
    expect(src).not.toMatch(/PickerMode|pickerMode/);
    expect(src).not.toMatch(/chat-picker__mode/);
    expect(src).not.toMatch(/data-mode=/);
    expect(src).not.toMatch(/emojiToMessage|emojiToTable|emojiMode/);
    expect(css).not.toContain('.chat-picker__mode');
    for (const lang of ['en', 'uk', 'de', 'ar']) {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      expect(dict, `${lang} still defines the mode labels`).not.toMatch(/chat\.emojiTo(Message|Table)|chat\.emojiMode/);
      expect(dict, `${lang} is missing the hint`).toContain("'chat.emojiHintMessage'");
      expect(dict, `${lang} is missing the hint`).toContain("'chat.emojiHintTable'");
    }
    for (const variant of VARIANTS) {
      const open = render(variant, 'chat');
      expect(open, `${variant} markup`).not.toContain('chat-picker__mode');
      expect(open, `${variant} markup`).not.toContain('data-mode=');
    }
  });

  it('focus is tracked from the field itself, and read live at click time', () => {
    expect(src).toContain('const focusedRef = useRef(false);');
    expect(src).toMatch(/onFocus=\{\(\) => setFocused\(true\)\} onBlur=\{\(\) => setFocused\(false\)\}/);
    expect(src).toMatch(/onClick=\{\(\) => \(focusedRef\.current \? insertEmoji\(e\) : react\(e\)\)\}/);
    // A blurred field with a draft still means "to the table": length must not decide.
    expect(src).not.toMatch(/text\.length\s*(>|===|!==)\s*0\s*\?/);
    expect(src).not.toMatch(/text\.trim\(\)[^;]*\?\s*insertEmoji/);
  });

  it('no picker control may steal focus — that would flip the tap\'s own meaning', () => {
    expect(src).toContain('const keepFocus = (e: { preventDefault: () => void }) => { e.preventDefault(); };');
    // The picker button, every emoji and every sticker cell cancel `mousedown`.
    expect(count(src, /onMouseDown=\{keepFocus\}/g)).toBe(3);
    const picker = src.slice(src.indexOf('const chatPicker ='), src.indexOf('const chatDialog ='));
    expect(picker).toContain('onMouseDown={keepFocus}');
    // …and closing the picker must not yank focus out of a field that still has it.
    expect(src).toMatch(/if \(!focusedRef\.current\) pickerBtnRef\.current\?\.focus\(\);/);
  });

  it('the hint is INERT — it reports the action, it is not a way to choose one', () => {
    expect(src).toMatch(/<p className="chat-picker__hint">\{emojiAction\}<\/p>/);
    expect(src).toMatch(/const emojiAction = inputFocused \? t\('chat.emojiHintMessage'\) : t\('chat.emojiHintTable'\);/);
    expect(css).toMatch(/\.chat-picker__hint \{[^}]*pointer-events: none/);
    const open = render('floating', 'chat');
    expect(open).not.toMatch(/chat-picker__hint[^>]*onclick/i);
  });

  it('"to message" inserts at the CARET without wiping what is typed', () => {
    expect(src).toContain('const start = el?.selectionStart ?? text.length;');
    expect(src).toContain('const end = el?.selectionEnd ?? text.length;');
    expect(src).toMatch(/text\.slice\(0, start\) \+ emoji \+ text\.slice\(end\)/);
    expect(src).not.toMatch(/setText\(\(prev\) => \(prev \+ emoji\)/); // the old append-only
  });

  it('"to table" sends the EXISTING server reaction, once, and touches no text', () => {
    expect(src).toMatch(/function react\(emoji: string\) \{\s*onReact\(emoji\);\s*\}/);
  });

  it('a table reaction is anchored on the sender SEAT, never on a display name', () => {
    expect(src).toContain('reactionAnchorForSender(r.seatIndex, mySeatIndex, seatCount, reactionsMirrored)');
    expect(src).not.toMatch(/reactionAnchorForSender\([^)]*\.name/);
  });
});

describe('stickers, and nothing that closes anything', () => {
  it('a sticker is ALWAYS chat media — focus plays no part in it', () => {
    expect(src).toMatch(/function sendMedia\(item: ChatMediaItem\) \{\s*onChatMedia\(item\.id\);\s*\}/);
    const grid = src.slice(src.indexOf('const stickerGrid ='), src.indexOf('const chatList ='));
    expect(grid).toContain('onClick={() => sendMedia(item)}');
    expect(grid).not.toMatch(/focusedRef/);
  });

  it('emoji, reaction and sticker sends leave both surfaces open', () => {
    expect(src).not.toMatch(/onReact\(emoji\);\s*set(React|Picker)Open\(false\)/);
    expect(src).not.toMatch(/onChatMedia\(item\.id\);\s*setPickerOpen\(false\)/);
  });

  it('Escape peels lightbox → picker → chat; ✕ and the backdrop close the chat', () => {
    expect(src).toMatch(/if \(lightbox\) \{ setLightbox\(null\); return; \}/);
    expect(src).toMatch(/if \(pickerOpen\) \{ closePicker\(\); return; \}/);
    expect(src).toContain('className="chat-dialog-backdrop" role="presentation" onClick={closeChat}');
    expect(src).toContain('className="chat-dialog__close" onClick={closeChat}');
  });

  it('the picker button toggles ONLY the picker', () => {
    expect(src).toMatch(/onClick=\{\(\) => \(pickerOpen \? closePicker\(\) : setPickerOpen\(true\)\)\}/);
  });
});

describe('the dialog is bounded, safe-area aware, and identical everywhere', () => {
  it('it is anchored to the VIEWPORT, so no game\'s layout can move it', () => {
    const bd = css.slice(css.indexOf('.chat-dialog-backdrop {'));
    const body = bd.slice(0, bd.indexOf('}'));
    expect(body).toMatch(/position: fixed; inset: 0/);
    expect(body).toContain('rgba(0, 0, 0, 0.62)');
    expect(body).toMatch(/align-items: flex-end/);   // phone: a bottom sheet
  });

  it('desktop centres the same card', () => {
    expect(css).toMatch(/@media \(min-width: 700px\) \{\s*\.chat-dialog-backdrop \{ align-items: center;/);
  });

  it('it is capped, opaque and honours the safe area', () => {
    const rule = css.slice(css.indexOf('.chat-dialog {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/max-height: min\(80vh, 34rem\)/);
    expect(body).toMatch(/width: min\(100%, 32rem\)/);
    expect(body).toContain('background: var(--panel)');
    expect(body).toContain('env(safe-area-inset-bottom)');
    expect(body).toContain('env(safe-area-inset-left)');
    expect(body).toContain('env(safe-area-inset-right)');
  });

  it('every control inside it is a real phone tap target', () => {
    expect(css).toMatch(/\.chat-dialog button \{[^}]*min-height: 44px[^}]*min-width: 44px/);
  });

  it('the picker has its own capped height and a single scroll', () => {
    const rule = css.slice(css.indexOf('.chat-picker {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/max-height: min\(30vh, 210px\)/);
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('overflow-x: hidden');
    expect(css).toMatch(/\.chat-picker \.reaction-bar__stickers \{[^}]*max-height: none[^}]*overflow: visible/);
  });

  it('the history keeps a floor so the picker can never squeeze it away', () => {
    expect(css).toMatch(/\.chat-dialog__list \{[^}]*min-height: 6\.5rem/);
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

  it('local play never mounts any of this', () => {
    expect(read('src/ui/LocalGame.tsx')).not.toContain('RoomSocial');
  });
});
