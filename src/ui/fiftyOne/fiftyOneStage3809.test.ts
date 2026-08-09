// ---------------------------------------------------------------------------
// Stage 38.0.9 — the UI half of the six owner FAILs.
//
// The vitest env is `node` (no jsdom), so behaviour is proved by SSR markup + source and
// CSS contracts; the real geometry (360 → 2560, LTR + Arabic RTL, and the REAL clicks that
// must not close the sheet) is measured by `npm run layout:fiftyone`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import FiftyOneLayoffDialog from './FiftyOneLayoffDialog';
import { LangProvider } from '../../i18n';
import { legalLayoffPlacements, resolveMeld } from '../../games/fiftyOne/melds';
import type { FiftyOneCard } from '../../games/fiftyOne/types';
import type { Rank, Suit } from '../../models/types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}`, joker: false, suit, rank });
const J = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });

describe('FAIL A — a reaction must not close the sheet', () => {
  const src = read('src/ui/online/RoomSocial.tsx');

  it('no send path closes anything, in any variant (38.0.12 unified this)', () => {
    expect(src).toMatch(/function react\(emoji: string\) \{\s*onReact\(emoji\);\s*\}/);
    expect(src).toMatch(/function sendMedia\(item: ChatMediaItem\) \{\s*onChatMedia\(item\.id\);\s*\}/);
    expect(src).not.toMatch(/onReact\(emoji\);\s*set\w+\(false\)/);
    expect(src).not.toMatch(/onChatMedia\(item\.id\);\s*set\w+\(false\)/);
  });

  it('only the deliberate gestures close it', () => {
    // ✕, Escape and the chat launcher — and nothing else clears the panel.
    // (38.0.14) There is no backdrop to click any more: the chat is not a modal.
    expect(src).toContain('className="chat-panel__close" onClick={closeChat}');
    // No backdrop ELEMENT exists to click (the word survives only in the comment that
    // records why it was removed).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('backdrop');
    expect(src).toMatch(/if \(pickerOpen\) \{ closePicker\(\); return; \}/);
    expect(src).toMatch(/onClick=\{\(\) => \(chatOpen \? closeChat\(\) : setPanel\('chat'\)\)\}/);
    expect((src.match(/setPanel\('none'\)/g) ?? []).length).toBe(1);   // inside closeChat only
  });

  it('(38.0.14) Poker mounts the same in-flow node through its generic slot', () => {
    const online = read('src/ui/online/OnlineGame.tsx');
    const poker = online.slice(online.indexOf("if (net.room?.gameType === 'poker') {"));
    expect(poker).toContain('socialSlot={social}');
    expect(poker).not.toContain('variant="docked"');
    expect(poker).not.toContain('variant="sheet"');
  });
});

describe('FAIL B — the sticker grid renders a full square', () => {
  const css = read('src/styles/social.css');

  it('the cell is square, a real tap target, and its size never depends on the image', () => {
    const cell = css.slice(css.indexOf('.chat-media-thumb {'), css.indexOf('.chat-media-thumb:hover'));
    expect(cell).toContain('aspect-ratio: 1 / 1');
    expect(cell).toMatch(/min-width: 44px; min-height: 44px/);
  });

  it('the image FILLS its cell and contains itself — never the old intrinsic sizing', () => {
    const img = css.slice(css.indexOf('.chat-media-thumb img {'));
    const rule = img.slice(0, img.indexOf('}'));
    expect(rule).toContain('width: 100%');
    expect(rule).toContain('height: 100%');
    expect(rule).toContain('object-fit: contain');
    // The measured RED was a 37px image inside an 81px cell, caused by `max-*: 100%`.
    expect(rule).not.toContain('max-width: 100%');
    expect(rule).not.toContain('max-height: 100%');
  });

  it('the grid picks its columns from the real width and scrolls only vertically', () => {
    const grid = css.slice(css.indexOf('.reaction-bar__stickers {'), css.indexOf('.reaction-bar__stickers::'));
    expect(grid).toContain('repeat(auto-fill, minmax(60px, 1fr))');
    expect(grid).toContain('grid-auto-rows: min-content');
    expect(grid).toContain('align-items: start');
    expect(grid).toContain('overflow-y: auto');
    expect(grid).toContain('overflow-x: hidden');
    expect(grid).not.toContain('repeat(4, 1fr)');
  });

  it('the emoji buttons are tap targets too', () => {
    const btn = css.slice(css.indexOf('.reaction-bar__btn {'), css.indexOf('.reaction-bar__btn:hover'));
    expect(btn).toMatch(/min-width: 44px; min-height: 44px/);
  });
});

describe('FAIL C — meld groups hug their content', () => {
  const css = read('src/styles/fiftyone.css');

  it('a group no longer grows to fill the row', () => {
    const group = css.slice(css.indexOf('.fiftyone-meldgroup {'), css.indexOf('.fiftyone-meldgroup--out'));
    expect(group).toContain('flex: 0 1 auto');
    expect(group).toContain('align-self: flex-start');
    expect(group).not.toContain('flex: 1 1 100%;\n  max-width: 100%;\n  padding');
    // The old artificial desktop 2-up rule is gone (it survives only as a comment).
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('flex: 1 1 22rem');
    expect(code).not.toContain('max-width: calc(50% - 0.2rem)');
  });

  it('groups are top-aligned so a short one is never stretched to a tall neighbour', () => {
    const melds = css.slice(css.indexOf('.fiftyone-melds {'), css.indexOf('.fiftyone-melds__empty'));
    expect(melds).toContain('align-items: flex-start');
    expect(melds).toContain('align-content: flex-start');
  });

  it('a phone may still give the group the whole row (the cards need it)', () => {
    expect(css).toMatch(/@media \(max-width: 559px\) \{\s*\.fiftyone-meldgroup \{ flex: 1 1 100%; \}/);
  });

  it('the 18rem cap and overflow masking are still gone', () => {
    expect(css).not.toContain('max-width: min(100%, 18rem)');
    // No CARD container masks its content. (`overflow: hidden` stays allowed on the owner
    // NAME, where it is a text ellipsis for a long display name.)
    for (const sel of ['.fiftyone-melds {', '.fiftyone-meldgroup {', '.fiftyone-meld {',
      '.fiftyone-meld__cards {', '.fiftyone-meldcard {']) {
      const at = css.indexOf(sel);
      expect(at, sel).toBeGreaterThan(-1);
      const rule = css.slice(at, css.indexOf('}', at));
      expect(rule, sel).not.toMatch(/overflow[^:]*:\s*(hidden|auto|scroll)/);
    }
  });
});

describe('FAIL E — the ambiguous side chooser', () => {
  const options = () => {
    const meld = resolveMeld([c('4', 'spades'), c('5', 'spades'), c('6', 'spades')])!;
    return legalLayoffPlacements(meld.cards, [J()]);
  };
  const html = () => renderToStaticMarkup(createElement(LangProvider, null,
    createElement(FiftyOneLayoffDialog, { options: options(), onPick: () => {}, onCancel: () => {} })));

  it('offers both sides with the card each one produces', () => {
    const out = html();
    expect(out).toContain('fiftyone-layoff-dialog');
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect((out.match(/fiftyone-layoff-option"/g) ?? []).length).toBe(2);
    expect(out).toContain('At the start');
    expect(out).toContain('At the end');
    expect(out).toContain('🃏 = 3♠');       // start
    expect(out).toContain('🃏 = 7♠');       // end
    expect(out).toContain('Cancel');
  });

  it('is opaque, bounded and every control is ≥44px', () => {
    const css = read('src/styles/fiftyone.css');
    const dialog = css.slice(css.indexOf('.fiftyone-layoff-dialog {'), css.indexOf('.fiftyone-layoff-dialog__title'));
    expect(dialog).toContain('background: var(--panel)');
    expect(dialog).not.toContain('var(--surface)');
    expect(dialog).toMatch(/max-height: 86vh; overflow-y: auto/);
    expect(css).toMatch(/\.fiftyone-layoff-option \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.fiftyone-layoff-cancel \{[^}]*min-height: 44px/);
  });

  it('traps + returns focus, cancels on Escape/backdrop, and dispatches once', () => {
    const src = read('src/ui/fiftyOne/FiftyOneLayoffDialog.tsx');
    expect(src).toContain('firstRef.current?.focus()');
    expect(src).toContain('(opener as HTMLElement | null)?.focus?.();');
    expect(src).toMatch(/e\.key === 'Escape'[\s\S]{0,60}onCancel\(\)/);
    expect(src).toMatch(/e\.key !== 'Tab'/);
    expect(src).toContain('onClick={onCancel}');
    expect(src).toContain('if (picked.current) return;');
    expect(src).toContain('picked.current = true;');
    expect(src).toContain('onPick(o);');
  });

  it('the screen only opens it when the SHARED helper reports two sides', () => {
    const screen = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');
    expect(screen).toContain('return legalLayoffPlacements(meld.cards, selectedCards);');
    expect(screen).toMatch(/if \(options\.length === 0\) return;\s*\n\s*if \(options\.length === 1\) \{ layoff\(meld, options\[0\]\); return; \}/);
    expect(screen).toMatch(/setPendingLayoff\(\{ meld, options \}\)/);
    // The control itself is hidden when nothing is legal.
    expect(screen).toContain('return layoffOptions(meld).length > 0;');
    // …and the dispatched action always carries the chosen side.
    expect(screen).toContain("apply({ type: 'ADD_TO_MELD', meldId: meld.id, cards: selectedCards, placement: option.placement })");
  });
});

describe('FAIL F — the selection survives a same-length update', () => {
  const screen = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');

  it('a full reset now happens ONLY on a real turn change', () => {
    expect(screen).toMatch(/\}, \[currentSeat, turnStep, phase, roundNumber\]\);/);
    // The length-based identity that missed a same-length mutation is gone.
    expect(screen).not.toMatch(/\}, \[currentSeat, turnStep, phase, roundNumber, hand\.length, state\.publicMelds\.length\]\);/);
  });

  it('an ordinary update RECONCILES against the authoritative ids instead', () => {
    expect(screen).toContain('const poolIds = useMemo(() => new Set(pool.map((c) => c.id)), [pool]);');
    expect(screen).toContain("const poolKey = useMemo(() => [...poolIds].sort().join('|'), [poolIds]);");
    expect(screen).toMatch(/setSelected\(\(cur\) => \{\s*const next = cur\.filter\(\(id\) => poolIds\.has\(id\)\);/);
    expect(screen).toMatch(/setStaged\(\(cur\) => \{\s*const next = cur\.filter\(\(group\) => group\.every\(\(id\) => poolIds\.has\(id\)\)\);/);
    // An unchanged pool returns the SAME array reference → no needless re-render/reset.
    expect(screen).toContain('return next.length === cur.length ? cur : next;');
    expect(screen).toMatch(/\}, \[poolKey\]\);/);
  });

  it('local and online drive the SAME screen, helper and reducer', () => {
    const localSrc = read('src/ui/fiftyOne/FiftyOneLocalGame.tsx');
    const onlineSrc = read('src/ui/fiftyOne/FiftyOneOnlineGame.tsx');
    expect(localSrc).toContain('FiftyOneGameScreen');
    expect(onlineSrc).toContain('FiftyOneGameScreen');
    // Neither one re-implements legality; both dispatch through the same screen.
    for (const s of [localSrc, onlineSrc]) {
      expect(s).not.toContain('legalLayoffPlacements');
      expect(s).not.toContain('resolveMeld');
    }
  });
});
