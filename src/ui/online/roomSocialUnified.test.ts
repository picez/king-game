// ---------------------------------------------------------------------------
// Stage 38.0.14 — the room chat is NON-MODAL and lives in normal document flow.
//
// The owner CRITICAL FAIL. Stage 38.0.13 (below) unified the chat into one canonical
// element — and made that element a MODAL, which broke the thing a chat may never break:
// the live game. Measured at `8523361` by `npm run layout:social`, over the REAL online
// branch of all seven games, at 360/390/768/1366:
//
//   * `.chat-dialog-backdrop` covered the whole viewport (390x844, rgba(0,0,0,.62));
//   * the panel carried `aria-modal="true"`;
//   * `documentElement { overflow: hidden }` froze the page scroll;
//   * the chat sat ON TOP of the board / melds / hand / action row (63 intersections);
//   * 146 sampled taps over gameplay landed inside the chat instead;
//   * a click on a LEGAL card / action reached the game **0 times** (expected 1) while
//     the authoritative timer kept counting down — and the click, landing on the
//     backdrop, closed the chat instead of playing the card.
//
// The contract asserted here:
//   * no backdrop, no `aria-modal`, no focus trap, no scroll lock, no fixed/absolute
//     positioning anywhere in the cluster;
//   * ONE `chat-panel` section, declared once, rendered once, identical in every game;
//   * every one of the seven game screens takes the SAME generic `socialSlot`, and none
//     of them imports RoomSocial;
//   * (38.0.15 corrective) ONE emoji set. The owner rejected the two labelled rows as a
//     visible duplicate — measured at `12cef31` on the real Durak/51/Poker branches at
//     360/390, LTR and Arabic RTL: `emojiContainers` 2, `emojiButtons` 14 for 7 REACTIONS,
//     every emoji twice, both headings on screen. There is now one container, one
//     `REACTIONS.map`, no headings, and the destination comes from the intent captured on
//     `pointerdown` — typing → the caret, not typing → the table;
//   * local play mounts none of it.
//
// The live proof — that a legal move still reaches the game with the chat open, and that
// neither the move nor the STATE_UPDATE after it closes the chat — is measured in a real
// browser by `npm run layout:social` (the vitest env has no DOM).
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
const online = read('src/ui/online/OnlineGame.tsx');
const noop = () => {};

const chat: ChatMessage[] = Array.from({ length: 4 }, (_, i) => ({
  id: `m${i}`, clientId: i % 2 ? 'me' : 'other', name: 'Kai', avatar: '🙂',
  text: `msg ${i}`, createdAt: 1_700_000_000_000 + i, seatIndex: i % 2,
} as ChatMessage));

function render(openPanel: SocialPanel, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(RoomSocial, {
    reactions: [], chat, myClientId: 'me',
    onReact: noop, onChat: noop, onChatMedia: noop,
    notice: null, onClearNotice: noop,
    openPanel, onPanelChange: noop,
    ...extra,
  } as never)));
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
/** The body of a top-level `function name(...)` in the component, and nothing after it. */
function fnBody(name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  const end = src.indexOf('\n  }', at);
  return src.slice(at, end);
}
/** Source with comments stripped: a comment recording the RED is evidence, not code. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The seven online game screens, each of which must take the SAME generic slot. */
const SCREENS = [
  'src/ui/GameScreen.tsx',
  'src/ui/durak/DurakGameScreen.tsx',
  'src/ui/deberc/DebercGameScreen.tsx',
  'src/ui/tarneeb/TarneebGameScreen.tsx',
  'src/ui/preferans/PreferansGameScreen.tsx',
  'src/ui/fiftyOne/FiftyOneGameScreen.tsx',
  'src/ui/poker/PokerGameScreen.tsx',
];

describe('the chat is NOT a modal and never blocks the game', () => {
  it('renders no backdrop, in any state', () => {
    for (const panel of ['none', 'chat', 'utility'] as SocialPanel[]) {
      const out = render(panel, { utilityPanelSlot: createElement('div', { className: 'probe-util-panel' }) });
      expect(out, panel).not.toContain('backdrop');
    }
    expect(code, 'the backdrop element survives in the source').not.toContain('backdrop');
    // `.permleave-backdrop` survives on purpose: an IRREVERSIBLE action must be read
    // before it happens. No chat/social backdrop may exist.
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssCode).not.toContain('chat-dialog-backdrop');
    expect(cssCode).not.toContain('social-sheet-backdrop');
    expect(cssCode.match(/[\w-]*backdrop/g) ?? []).toEqual(['permleave-backdrop']);
  });

  it('declares no modal semantics and traps no focus', () => {
    const out = render('chat');
    expect(out).not.toContain('aria-modal');
    expect(out).not.toContain('role="dialog"');
    expect(out).toContain('<section class="chat-panel" aria-label=');
    // A focus trap would need to intercept Tab; nothing here does.
    expect(code).not.toMatch(/key === 'Tab'|keyCode === 9/);
  });

  it('never locks the page scroll — the player must be able to reach their hand', () => {
    expect(code).not.toMatch(/document(Element)?\.style\.overflow/);
    expect(code).not.toMatch(/body\.style\.overflow/);
    expect(code).not.toMatch(/overflow\s*=\s*'hidden'/);
    expect(css).not.toMatch(/^(html|body)[^{]*\{[^}]*overflow[^}]*hidden/m);
  });

  it('nothing in the cluster is positioned out of flow', () => {
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.room-social {', '.room-social__bar {', '.chat-panel {',
      '.chat-panel__head {', '.chat-panel__list {', '.chat-panel__compose {']) {
      const at = cssCode.indexOf(sel);
      expect(at, sel).toBeGreaterThan(-1);
      const rule = cssCode.slice(at, cssCode.indexOf('}', at));
      expect(rule, sel).not.toMatch(/position:\s*(fixed|absolute|sticky)/);
    }
    // The only fixed elements left are the pointer-through reaction layer, the transient
    // toast (also pointer-through) and the deliberate sticker lightbox.
    const fixedRules = [...cssCode.matchAll(/([^{}]+)\{[^}]*position:\s*fixed[^}]*\}/g)]
      .map((m) => m[1].trim().split('\n').pop()!.trim());
    // `.permleave-backdrop` is a modal ON PURPOSE (an irreversible confirmation).
    expect(fixedRules.sort()).toEqual([
      '.chat-lightbox', '.permleave-backdrop', '.reactions-float', '.social-toast',
    ]);
    expect(cssCode).toMatch(/\.social-toast \{[^}]*pointer-events: none/);
    expect(cssCode).toMatch(/\.reactions-float \{[^}]*pointer-events: none/);
  });

  it('the per-variant overlays are gone for good', () => {
    for (const dead of ['social-controls', 'social-menu', 'social-sheet', 'chat-drawer', 'chat-dialog']) {
      expect(src, dead).not.toContain(dead);
      expect(css, dead).not.toContain(dead);
    }
    expect(src, 'the layout variant prop survives').not.toMatch(/variant\?: 'floating'/);
    expect(online).not.toContain('variant="docked"');
    expect(online).not.toContain('variant="sheet"');
  });
});

describe('ONE chat panel, one cluster, in normal flow', () => {
  it('the panel is declared once and rendered once', () => {
    expect(count(src, /const chatPanel =/g)).toBe(1);
    // (38.0.16) One declaration, one RENDER — but the render has two homes: the social
    // region when the room layout provides one, and in flow when it does not (the lobby,
    // an isolated harness). They are the two arms of a single expression, never two panels.
    expect(count(src, /\{chatPanel\}/g)).toBe(2);
    expect(src).toMatch(/panelHost\s*\?\s*createPortal\(<>\{utilityPanelSlot\}\{chatPanel\}<\/>, panelHost\)/);
    expect(count(src, /const chatPicker =/g)).toBe(1);
    expect(count(src, /const chatCompose =/g)).toBe(1);
    expect(count(src, /const chatList =/g)).toBe(1);
  });

  it('open, it holds the heading, the history, the composer and the picker button', () => {
    const out = render('chat');
    expect(count(out, /class="chat-panel"/g)).toBe(1);
    expect(count(out, /class="chat-panel__title"/g)).toBe(1);
    expect(count(out, /class="chat-panel__close"/g)).toBe(1);
    expect(count(out, /class="chat-panel__list"/g)).toBe(1);
    expect(count(out, /class="chat-panel__compose"/g)).toBe(1);
    expect(count(out, /chat-picker-btn/g)).toBe(1);
    expect(out).toContain('type="submit"');
  });

  it('collapsed, it costs one compact control row and nothing else', () => {
    const out = render('none');
    expect(out).toContain('room-social__bar');
    expect(out).not.toContain('chat-panel');
    expect(count(out, /💬/g)).toBe(1);
    expect(out.includes('>😀<'), 'a standalone reactions button is back').toBe(false);
  });

  it('the caller\'s utility panel is an in-flow sibling, never an overlay', () => {
    const out = render('utility', {
      utilitySlot: createElement('button', { className: 'probe-util' }, 'u'),
      utilityPanelSlot: createElement('div', { className: 'probe-util-panel' }),
    });
    expect(out).toContain('probe-util');
    expect(out).toContain('probe-util-panel');
    expect(out).not.toContain('chat-panel');
  });

  it('the panel is bounded and safe-area aware, so the hand stays one scroll away', () => {
    // Anchor on the STANDALONE rule: `.social-region .chat-panel { … }` (the wide-screen
    // rail override) also contains the substring `.chat-panel {`.
    const rule = css.slice(css.search(/^\.chat-panel \{/m));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/max-height: min\(46vh, 24rem\)/);
    expect(body).toContain('width: 100%');
    expect(body).toContain('background: var(--panel)');
    expect(body).toContain('env(safe-area-inset-left)');
    expect(body).toContain('env(safe-area-inset-right)');
    expect(css).toMatch(/\.room-social \{[^}]*padding-bottom: env\(safe-area-inset-bottom\)/);
  });

  it('the history keeps its floor and the picker stays bounded', () => {
    expect(css).toMatch(/\.chat-panel__list \{[^}]*min-height: 6\.5rem/);
    expect(css).toMatch(/\.chat-picker \{[^}]*flex: 0 1 auto[^}]*min-height: 0/);
    expect(css).toMatch(/\.chat-picker \{[^}]*max-height: min\(30vh, 210px\)/);
  });

  it('every control keeps a 44px tap target', () => {
    expect(css).toMatch(/\.chat-panel button \{[^}]*min-height: 44px[^}]*min-width: 44px/);
    expect(css).toMatch(/\.room-social__bar \.social-fab \{[^}]*min-width: 44px[^}]*min-height: 44px/);
  });
});

describe('all seven screens take the SAME generic slot', () => {
  it('each screen declares `socialSlot` and renders it', () => {
    for (const path of SCREENS) {
      const s = read(path);
      expect(s, path).toMatch(/socialSlot\?: ReactNode/);
      expect(s, path).toContain('{socialSlot}');
    }
  });

  it('no game screen imports RoomSocial — the node always arrives as a slot', () => {
    for (const path of SCREENS) {
      // Comments may NAME it (they explain who fills the slot); code may not use it.
      const body = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(body, path).not.toContain('RoomSocial');
    }
  });

  it('OnlineGame builds it ONCE and hands it to every branch', () => {
    expect(online).toMatch(/const renderSocial = \(/);
    expect(count(online, /<RoomSocial/g), 'one factory + 51 + poker').toBe(3);
    // Four games via the factory, plus 51 and Poker, plus King through the context.
    expect(count(online, /socialSlot=\{renderSocial\(true/g)).toBe(4);
    expect(online).toContain('socialSlot={fiftyOneSocial}');
    expect(online).toContain('socialSlot={social}');
    expect(online).toMatch(/socialSlot: renderSocial\(status === 'playing', leaveGameToMenu\)/);
    // …and no branch renders it as a bare sibling of the game screen any more.
    expect(online).not.toMatch(/^\s*\{renderSocial\(true/m);
  });

  it('King reaches its screens through the context, and only in flow', () => {
    const ctx = read('src/hooks/useGame.ts');
    expect(ctx).toMatch(/socialSlot\?: ReactNode/);
    const router = read('src/ui/GameRouter.tsx');
    expect(router).toContain('const { state, socialSlot } = useGame();');
    expect(router).toContain('<GameScreen socialSlot={socialSlot} />');
    const screen = read('src/ui/GameScreen.tsx');
    // Between the public table and the hand: opening the chat can never cover the cards.
    expect(screen.indexOf('{socialSlot}')).toBeGreaterThan(screen.indexOf('game-body'));
    expect(screen.indexOf('{socialSlot}')).toBeLessThan(screen.indexOf('game-footer'));
  });

  it('local play mounts none of it', () => {
    expect(read('src/ui/LocalGame.tsx')).not.toContain('RoomSocial');
    expect(read('src/ui/LocalGame.tsx')).not.toContain('socialSlot');
  });
});

describe('(38.0.15 corrective) ONE emoji set, contextual destination', () => {
  it('the picker declares exactly ONE emoji container and ONE REACTIONS.map', () => {
    expect(count(code, /className="chat-picker__emoji"/g)).toBe(1);
    expect(count(code, /REACTIONS\.map/g)).toBe(1);   // `code` = comments stripped
    expect(count(css, /\.chat-picker__emoji\b/g)).toBe(1);
  });

  it('every emoji appears exactly once in the rendered picker', () => {
    // Render the picker by driving the component's own markup path: the picker is closed
    // until tapped, so the DOM proof lives in the browser gate; here we prove the SOURCE
    // cannot emit a second set — no duplicate map, no per-destination wrapper, no factory.
    expect(src).not.toMatch(/emojiRow|reaction-bar__emojis--/);
    expect(src).not.toMatch(/chat-picker__section/);
    expect(css).not.toContain('chat-picker__section');
    expect(css).not.toContain('.chat-picker__hint');
  });

  it('the destination labels and hints are DELETED, not hidden', () => {
    expect(src).not.toMatch(/chat-picker__hint|emojiToMessage|emojiToTable|emojiHint/);
    // Nothing may bring them back through CSS either.
    expect(css).not.toMatch(/chat-picker__(hint|section|mode)/);
    for (const lang of ['en', 'uk', 'de', 'ar']) {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      expect(dict, lang).not.toMatch(/chat\.emojiTo(Message|Table)|chat\.emojiHint(Message|Table)|chat\.emojiMode/);
    }
    // No mode state either (38.0.12's RED).
    expect(src).not.toMatch(/PickerMode|pickerMode|data-mode=/);
  });

  it('the intent is captured on POINTERDOWN, before any blur can flip it', () => {
    expect(src).toContain('const intentRef = useRef<boolean | null>(null);');
    expect(src).toMatch(/const isTyping = \(\) => typeof document !== 'undefined' && document\.activeElement === inputRef\.current;/);
    expect(src).toContain('const captureIntent = () => { intentRef.current = isTyping(); };');
    expect(src).toMatch(/onPointerDown=\{captureIntent\}/);
    // …and merely SPENT on click, with a live-focus fallback for keyboard activation.
    expect(fnBody('pickEmoji')).toMatch(/const typing = intentRef\.current \?\? isTyping\(\);[^]*intentRef\.current = null;[^]*if \(typing\) insertEmoji\(emoji\); else react\(emoji\);/);
    expect(src).toMatch(/onClick=\{\(\) => pickEmoji\(e\)\}/);
    expect(src).not.toMatch(/text\.length\s*(>|===|!==)\s*0\s*\?/);
  });

  it('typing → insert at the caret, and NOTHING is sent', () => {
    const insert = fnBody('insertEmoji');
    expect(insert).toMatch(/const start = el\?\.selectionStart \?\? text\.length;/);
    expect(insert).toMatch(/text\.slice\(0, start\) \+ emoji \+ text\.slice\(end\)/);
    expect(insert).toMatch(/input\?\.focus\(\);[^]*setSelectionRange\(caret, caret\)/);
    expect(insert).not.toMatch(/onReact|onChat/);
  });

  it('not typing → exactly one reaction, draft and focus untouched', () => {
    expect(src).toMatch(/function react\(emoji: string\) \{\s*onReact\(emoji\);\s*\}/);
    expect(fnBody('react')).not.toMatch(/setText|focus\(\)|setPicker|setPanel/);
    expect(src).not.toMatch(/onReact\(emoji\);\s*set(React|Picker)Open\(false\)/);
  });

  it('no picker control steals focus — the opener included', () => {
    expect(src).toContain('const keepFocus = (e: { preventDefault: () => void }) => { e.preventDefault(); };');
    // picker opener + the emoji button + the sticker thumb + (38.0.16) remove-attachment.
    expect(count(src, /onMouseDown=\{keepFocus\}/g)).toBe(4);
    expect(src).toMatch(/className="btn btn--ghost btn--small chat-picker-btn"[^]*onMouseDown=\{keepFocus\}/);
    expect(src).toMatch(/if \(!isTyping\(\)\) pickerBtnRef\.current\?\.focus\(\);/);
  });

  it('the sticker catalog is untouched, and a sticker is still a message', () => {
    // (38.0.16) With a draft it ATTACHES to that draft; with no draft it is still the
    // same one-tap media-only send it always was.
    expect(src).toMatch(/function sendMedia\(item: ChatMediaItem\) \{/);
    expect(fnBody('sendMedia')).toMatch(/setAttachment\(item\)/);
    expect(fnBody('sendMedia')).toMatch(/onChatMedia\(item\.id\)/);
    expect(src).toContain('CHAT_MEDIA.map((item)');
    expect(src).not.toMatch(/CHAT_MEDIA\.(slice|filter|sort)/);
  });

  it('Escape still peels lightbox → picker → chat, and ✕ closes the chat', () => {
    expect(src).toMatch(/if \(lightbox\) \{ setLightbox\(null\); return; \}/);
    expect(src).toMatch(/if \(pickerOpen\) \{ closePicker\(\); return; \}/);
    expect(src).toContain('className="chat-panel__close" onClick={closeChat}');
  });

  it('a table reaction is anchored on the sender SEAT, never on a display name', () => {
    expect(src).toContain('reactionAnchorForSender(r.seatIndex, mySeatIndex, seatCount, reactionsMirrored)');
    expect(src).not.toMatch(/reactionAnchorForSender\([^)]*\.name/);
  });
});

describe('what must NOT change', () => {
  it('RoomSocial still knows nothing about any game', () => {
    expect(code).not.toMatch(/poker|fifty-?one|durak|deberc|tarneeb|preferans/i);
    expect(code).not.toMatch(/gameType/);
  });

  it('the sticker catalog is used whole — never sliced or rebuilt here', () => {
    expect(src).toContain('CHAT_MEDIA.map((item)');
    expect(src).not.toMatch(/CHAT_MEDIA\.(slice|filter|sort)/);
  });
});
