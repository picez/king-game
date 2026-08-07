// ---------------------------------------------------------------------------
// Stage 38.0.8 — the anti-dumping UI: the Ranked/Unranked badge, the rebuy counter,
// the pre-debit confirmation and the cooldown note.
//
// The vitest env is `node` (no jsdom), so behaviour is proved by SSR markup + source and
// CSS contracts; the real 360/390 + Arabic-RTL geometry is measured by
// `npm run layout:poker`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import PokerUnrankedDialog from './PokerUnrankedDialog';
import PokerGameScreen from './PokerGameScreen';
import { LangProvider } from '../../i18n';
import { pokerReducer } from '../../games/poker/engine';
import type { PokerState } from '../../games/poker/types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

/** A REAL dealt heads-up state from the engine — no hand-rolled shape can drift from it. */
function state(): PokerState {
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: ['A', 'B'], playerTypes: ['human', 'human'], playerCount: 2,
    buttonSeat: 0, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50, blindGrowthEveryHands: 0 },
  } as never, { rng: () => 0.42 }) as PokerState;
}

const screen = (over: Record<string, unknown> = {}) => createElement(LangProvider, null,
  createElement(PokerGameScreen, {
    state: state(), mySeat: 0, apply: () => {}, onExit: () => {}, ...over,
  } as never));

describe('the Ranked / Unranked badge and the rebuy counter', () => {
  it('an ONLINE ranked table shows Ranked and the remaining rebuys', () => {
    const out = html(screen({ online: true, statsEligible: true, rebuysLeft: 2 }));
    expect(out).toContain('poker-policy-bar');
    expect(out).toContain('poker-policy-badge--ranked');
    expect(out).toContain('Ranked');
    expect(out).toContain('Rebuys left: 2');
  });

  it('an UNRANKED table says so, without any reason or threshold', () => {
    const out = html(screen({ online: true, statsEligible: false, rebuysLeft: 0 }));
    expect(out).toContain('poker-policy-badge--unranked');
    expect(out).toContain('Unranked');
    expect(out).toContain('Rebuys left: 0');
    // No explanation, no counts, no opponent — the badge states only what is true.
    for (const leak of ['opponent', 'pair', 'threshold', 'cooldown', '15', 'times']) {
      expect(out.toLowerCase(), leak).not.toContain(leak);
    }
  });

  it('LOCAL free Poker renders NO policy bar at all', () => {
    const out = html(screen());                       // no statsEligible, no rebuysLeft
    expect(out).not.toContain('poker-policy-bar');
    expect(out).not.toContain('Ranked');
    expect(out).not.toContain('Rebuys left');
  });

  it('a table with an unknown policy (legacy) shows no badge rather than guessing', () => {
    const out = html(screen({ online: true }));
    expect(out).not.toContain('poker-policy-badge');
  });
});

describe('the pre-debit unranked confirmation', () => {
  const out = html(createElement(LangProvider, null,
    createElement(PokerUnrankedDialog, { onConfirm: () => {}, onCancel: () => {} })));

  it('is a real modal with both buttons', () => {
    expect(out).toContain('poker-policy-backdrop');
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('poker-policy-confirm');
    expect(out).toContain('poker-policy-cancel');
    expect(out).toMatch(/aria-labelledby="poker-unranked-title"/);
    expect(out).toMatch(/aria-describedby="poker-unranked-body"/);
  });

  it('states what will and will not happen — and never accuses anyone', () => {
    expect(out).toContain('will not affect the Poker rating');
    expect(out).toContain('Chips and payouts work as usual');
    expect(out).toContain('Continue unranked');
    expect(out).toContain('Cancel');
    for (const word of ['cheat', 'fraud', 'ban', 'punish', 'suspicious', 'abuse']) {
      expect(out.toLowerCase(), word).not.toContain(word);
    }
  });

  it('the confirm button disables itself while a START is in flight', () => {
    const pending = html(createElement(LangProvider, null,
      createElement(PokerUnrankedDialog, { onConfirm: () => {}, onCancel: () => {}, pending: true })));
    expect((pending.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it('focus is moved in, trapped and returned; Escape/backdrop only cancel', () => {
    const src = read('src/ui/poker/PokerUnrankedDialog.tsx');
    expect(src).toContain('confirmRef.current?.focus()');
    expect(src).toMatch(/return \(\) => \{ \(opener as HTMLElement \| null\)\?\.focus\?\.\(\); \}/);
    expect(src).toMatch(/e\.key === 'Escape'[\s\S]{0,120}if \(!pending\) onCancel\(\)/);
    expect(src).toMatch(/e\.key !== 'Tab'/);
    expect(src).toContain('onClick={() => { if (!pending) onCancel(); }}');
  });
});

describe('the client can never ask to be ranked', () => {
  const hook = read('src/hooks/useNetworkGame.ts');
  const online = read('src/ui/online/OnlineGame.tsx');

  it('START carries only the acknowledgement boolean', () => {
    expect(hook).toMatch(/send\(unrankedConfirmed \? \{ t: 'START_GAME', pokerUnrankedConfirmed: true \} : \{ t: 'START_GAME' \}\)/);
    expect(hook).not.toMatch(/ranked:\s*true/);
  });

  it('a double-click on confirm sends exactly ONE START', () => {
    expect(online).toContain('const startPending = useRef(false)');
    expect(online).toMatch(/if \(startPending\.current\) return;\s*\/\/ double-click → exactly ONE START/);
    expect(online).toMatch(/startPending\.current = true;\s*\n\s*net\.startGame\(true\);/);
  });

  it('the badge is derived from the PUBLIC snapshot + public state only', () => {
    const branch = online.slice(online.indexOf("if (net.room?.gameType === 'poker')"));
    expect(branch).toContain('statsEligible={net.room?.pokerStatsEligible}');
    expect(branch).toContain('bankrollRebuysLeft(');
    expect(branch).not.toContain('antiDumpPolicy');
  });

  it('an anti-dumping refusal is a modal/note state, never the fatal error surface', () => {
    expect(hook).toMatch(/msg\.code === 'POKER_PAIR_COOLDOWN' \|\| msg\.code === 'POKER_UNRANKED_CONFIRM_REQUIRED'/);
    expect(hook).toMatch(/setPokerPolicy\(\{[\s\S]{0,200}retryAfterSeconds/);
  });

  it('the cooldown note names nobody and offers the local alternative', () => {
    for (const lang of ['en', 'uk', 'de', 'ar']) {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      expect(dict, lang).toContain("'poker.cooldownTitle'");
      expect(dict, lang).toContain("'poker.cooldownBody'");
      expect(dict, lang).toContain("'poker.cooldownRetry'");
      expect(dict, lang).toContain("'poker.ranked'");
      expect(dict, lang).toContain("'poker.unrankedBody'");
    }
    const en = read('src/i18n/dictionaries/en.ts');
    const body = en.slice(en.indexOf("'poker.cooldownBody'"), en.indexOf("'poker.cooldownRetry'"));
    expect(body).toContain('play locally without chips');
    for (const word of ['cheat', 'fraud', 'ban', 'punish', 'suspicious']) {
      expect(body.toLowerCase(), word).not.toContain(word);
    }
  });
});

describe('the mobile / RTL CSS contract', () => {
  const css = read('src/styles/poker.css');
  const block = css.slice(css.indexOf('.poker-policy-bar {'));

  it('the dialog is OPAQUE (never the translucent --surface)', () => {
    const dialog = block.slice(block.indexOf('.poker-policy-dialog {'), block.indexOf('.poker-policy-dialog__title'));
    expect(dialog).toContain('background: var(--panel)');
    expect(dialog).not.toContain('var(--surface)');
    expect(dialog).toMatch(/max-height: 86vh;\s*overflow-y: auto/);
  });

  it('every action is a ≥44px tap target and the buttons wrap on a phone', () => {
    expect(block).toMatch(/\.poker-policy-dialog__actions \.btn \{[^}]*min-height: 44px/);
    expect(block).toMatch(/\.poker-policy-dialog__actions \.btn \{[^}]*min-width: 44px/);
    expect(block).toMatch(/\.poker-policy-dialog__actions \{[^}]*flex-wrap: wrap/);
    expect(block).toMatch(/\.poker-policy-note \.btn \{[^}]*min-height: 44px/);
  });

  it('the badge row wraps and never overflows', () => {
    expect(block).toMatch(/\.poker-policy-bar \{[^}]*flex-wrap: wrap/);
    expect(block).toMatch(/\.poker-policy-bar \{[^}]*max-width: 100%/);
  });

  it('no physical left/right property — Arabic RTL mirrors for free', () => {
    expect(block.match(/(margin|padding|border)-(left|right)\s*:/g) ?? []).toEqual([]);
  });
});
