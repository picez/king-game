import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import { recentLogRows, firstShownIndex, hasUnreadActions, LOG_ROW_LIMIT } from './actionLog';
import PokerActionLog from './PokerActionLog';
import PokerGameScreen from './PokerGameScreen';
import { pokerReducer } from '../../games/poker/engine';
import { pokerRedactStateFor } from '../../games/poker/redact';
import type { PokerActionEntry, PokerState } from '../../games/poker/types';

// Stage 38.0.2 item 4 — the action history moved from an inline block under the table
// into ONE compact control: RoomSocial's generic `utilitySlot` online, a matching
// bottom-end cluster locally. Exactly one control and one panel per table.

const html = (el: ReactElement) => renderToStaticMarkup(el);

const entry = (seat: number, i: number): PokerActionEntry =>
  ({ seat, street: 'preflop', kind: i % 2 ? 'call' : 'bet', amount: 100 + i });

function stateWithLog(count: number): PokerState {
  const s = pokerReducer(null, {
    type: 'START_GAME', playerNames: ['Alice', 'Bob'], playerTypes: ['human', 'human'],
    playerCount: 2, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 },
  })!;
  return { ...s, actionLog: Array.from({ length: count }, (_, i) => entry(i % 2, i)) };
}

describe('pure log helpers', () => {
  it('caps the panel at the last 30 entries, oldest→newest', () => {
    expect(LOG_ROW_LIMIT).toBe(30);
    const log = Array.from({ length: 100 }, (_, i) => entry(0, i));
    const rows = recentLogRows(log);
    expect(rows).toHaveLength(30);
    expect(rows[0].amount).toBe(100 + 70);   // entry #70 is the first of the last 30
    expect(rows[29].amount).toBe(100 + 99);
  });

  it('a short log is returned whole', () => {
    const log = Array.from({ length: 4 }, (_, i) => entry(1, i));
    expect(recentLogRows(log)).toHaveLength(4);
    expect(recentLogRows([])).toEqual([]);
  });

  it('firstShownIndex keeps React keys stable as older rows scroll out', () => {
    expect(firstShownIndex(100, 30)).toBe(70);
    expect(firstShownIndex(4, 4)).toBe(0);
    expect(firstShownIndex(0, 0)).toBe(0);
  });

  it('unread only while CLOSED and only for actions after the last open', () => {
    expect(hasUnreadActions(5, 0, false)).toBe(true);   // new actions, panel closed
    expect(hasUnreadActions(5, 5, false)).toBe(false);  // all seen
    expect(hasUnreadActions(9, 5, true)).toBe(false);   // open → never a dot
    expect(hasUnreadActions(0, 0, false)).toBe(false);  // nothing happened yet
  });
});

describe('PokerActionLog — exactly one compact control, default closed', () => {
  it('renders ONE toggle and NO open panel by default', () => {
    const out = html(createElement(PokerActionLog, { state: stateWithLog(6) }));
    expect(out.match(/poker-log-fab/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('poker-log-panel');   // default CLOSED
    expect(out).toContain('aria-expanded="false"');
  });

  it('shows the unread dot when actions exist while closed, and none for an empty log', () => {
    expect(html(createElement(PokerActionLog, { state: stateWithLog(3) }))).toContain('poker-log-dot');
    expect(html(createElement(PokerActionLog, { state: stateWithLog(0) }))).not.toContain('poker-log-dot');
  });

  it('the local variant is the SAME component (no second implementation)', () => {
    const out = html(createElement(PokerActionLog, { state: stateWithLog(2), variant: 'standalone' }));
    expect(out).toContain('poker-logbox--standalone');
    expect(out.match(/poker-log-fab/g) ?? []).toHaveLength(1);
  });

  it('leaks nothing private — no hole cards, deck, burn cards, ids or escrow data', () => {
    const s = stateWithLog(8);
    const view = pokerRedactStateFor(s, 0);
    const out = html(createElement(PokerActionLog, { state: view }));
    for (const bad of ['holeCards', 'deck', 'burned', 'matchId', 'escrow', 'userId', 'token']) {
      expect(out).not.toContain(bad);
    }
    // Only public seat/name/action/amount can appear at all.
    for (const c of s.holeCardsBySeat.flat()) expect(out).not.toContain(c.id);
  });
});

describe('the inline log under the table is GONE', () => {
  const base = () => pokerReducer(null, {
    type: 'START_GAME', playerNames: ['Alice', 'Bob'], playerTypes: ['human', 'human'],
    playerCount: 2, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 },
  })!;

  it('PokerGameScreen renders NO log control or panel (online)', () => {
    const s = base();
    const out = html(createElement(PokerGameScreen, {
      state: s, mySeat: s.toActSeat, apply: () => {}, onExit: () => {}, online: true,
    }));
    expect(out).not.toContain('poker-logbox');
    expect(out).not.toContain('poker-log-toggle');
    expect(out).not.toContain('poker-log__list');
  });

  it('PokerGameScreen renders NO log control or panel (local)', () => {
    const s = base();
    const out = html(createElement(PokerGameScreen, {
      state: s, mySeat: s.toActSeat, apply: () => {}, onExit: () => {},
    }));
    expect(out).not.toContain('poker-logbox');
  });
});

describe('wiring — one control online (RoomSocial utilitySlot) and one locally', () => {
  const online = readFileSync(join(process.cwd(), 'src/ui/online/OnlineGame.tsx'), 'utf8');
  const social = readFileSync(join(process.cwd(), 'src/ui/online/RoomSocial.tsx'), 'utf8');
  const local = readFileSync(join(process.cwd(), 'src/ui/poker/PokerLocalGame.tsx'), 'utf8');
  const screen = readFileSync(join(process.cwd(), 'src/ui/poker/PokerGameScreen.tsx'), 'utf8');

  it('the poker branch hands the log to renderSocial as the utilitySlot', () => {
    expect(online).toContain('utilitySlot={utilitySlot}');
    expect(online).toMatch(/renderSocial\(true, undefined, timerEl, <PokerActionLog state=\{pokerState\} \/>\)/);
    // Exactly one poker log control is created in the online tree.
    expect(online.match(/<PokerActionLog/g) ?? []).toHaveLength(1);
  });

  it('RoomSocial stays poker-agnostic (no poker import/usage, generic slot only)', () => {
    // A doc comment may NAME poker as an example consumer; what must not exist is any
    // poker import or component usage inside RoomSocial.
    expect(social).not.toMatch(/import[^;]*poker/i);
    expect(social).not.toContain('PokerActionLog');
    expect(social).toContain('{utilitySlot}');
  });

  it('local renders the same component once, in its own bottom-end cluster', () => {
    expect(local).toContain('poker-local-utility');
    expect(local.match(/<PokerActionLog/g) ?? []).toHaveLength(1);
    expect(local).toContain("variant=\"standalone\"");
  });

  it('the shared table screen no longer owns a log at all', () => {
    expect(screen).not.toContain('PokerLog');
    expect(screen).not.toContain('LOG_KIND_KEY');
  });
});
