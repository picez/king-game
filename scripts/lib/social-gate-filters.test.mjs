// ---------------------------------------------------------------------------
// (Stage 38.0.16.2c.2) The gate's matrix selection, tested without a browser.
//
// The bug these guard: `--only 390` selected nothing and the run exited 0 with "0 social
// layout checks run". A focused reproduction built on that measured nothing while looking
// like a pass, which is worse than no filter at all.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import {
  parseFilters, selectMatrix, summarise, phasesFor, emptySelectionError,
} from './social-gate-filters.mjs';

const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: '1366', w: 1366, h: 900, mobile: false },
];
const VARIANTS = ['inflow'];
const SCENARIOS = [
  { name: 'collapsed', q: 'panel=none' },
  { name: 'chat', q: 'panel=chat' },
  { name: 'typing-caret', q: 'panel=chat', picker: true, act: 'typing-caret' },
];
const GAMES = [
  { tag: 'king', q: 'game=king&seats=4', action: null },
  { tag: 'durak', q: 'game=durak&seats=4', action: '.hand-reorder-wrap .card' },
  { tag: 'poker', q: 'game=poker&seats=4', action: '.poker-actions__primary button' },
];
const DIRS = ['ltr', 'rtl'];
const FULL = ['typing-caret', 'blurred-draft', 'blurred-empty', 'opened-while-typing', 'focus-switch', 'sticker', 'combined'];
const CORE = ['typing-caret', 'blurred-draft'];
const actsFor = (vpTag, dirTag, game) => {
  if (!game.action || !['360', '390'].includes(vpTag)) return [];
  return vpTag === '390' && dirTag === 'ltr' ? FULL : CORE;
};
const CAT = { viewports: VIEWPORTS, variants: VARIANTS, scenarios: SCENARIOS, games: GAMES, dirs: DIRS, actsFor };
const select = (filters, only = null) => selectMatrix(CAT, filters, only);

describe('parseFilters', () => {
  it('reads every filter, and reads none when none are given', () => {
    expect(parseFilters([]).filters).toEqual({});
    const { filters, errors } = parseFilters(
      ['--viewport', '390', '--game', 'durak', '--dir', 'ltr', '--act', 'typing-caret', '--scenario', 'collapsed']);
    expect(errors).toEqual([]);
    expect(filters).toEqual({
      viewport: ['390'], game: ['durak'], dir: ['ltr'], act: ['typing-caret'], scenario: ['collapsed'],
    });
  });

  it('accepts comma-separated values and ignores unrelated flags', () => {
    const { filters } = parseFilters(['--shots', 'out', '--viewport', '360,390', '--progress']);
    expect(filters.viewport).toEqual(['360', '390']);
    expect(filters.game).toBeUndefined();
  });

  it('refuses a flag with no value instead of silently selecting everything', () => {
    expect(parseFilters(['--viewport']).errors).toEqual(['--viewport needs a value']);
    expect(parseFilters(['--game', '--progress']).errors).toEqual(['--game needs a value']);
  });
});

describe('selectMatrix — no filters means the full matrix', () => {
  it('runs both phases, every viewport, every game, both directions', () => {
    const units = select({});
    const a = units.filter((u) => u.phase === 'A');
    const b = units.filter((u) => u.phase === 'B');
    expect(a).toHaveLength(VIEWPORTS.length * SCENARIOS.length);
    expect(b).toHaveLength(VIEWPORTS.length * DIRS.length * GAMES.length);
    // …and the default behaviour coverage is untouched by the new filters existing.
    const acts390ltr = b.filter((u) => u.vp.tag === '390' && u.dir === 'ltr');
    expect(acts390ltr.find((u) => u.game.tag === 'durak').acts).toEqual(FULL);
    expect(acts390ltr.find((u) => u.game.tag === 'king').acts).toEqual([]);
    expect(b.find((u) => u.vp.tag === '360' && u.dir === 'rtl' && u.game.tag === 'poker').acts).toEqual(CORE);
    expect(b.every((u) => u.actsOnly === false)).toBe(true);
  });

  it('keeps viewport as the outermost grouping', () => {
    const tags = select({}).map((u) => u.vp.tag);
    expect(tags).toEqual([...tags].sort((x, y) => VIEWPORTS.findIndex((v) => v.tag === x) - VIEWPORTS.findIndex((v) => v.tag === y)));
  });
});

describe('selectMatrix — each filter works on its own', () => {
  it('--viewport narrows both phases and nothing else', () => {
    const units = select({ viewport: ['390'] });
    expect(units.every((u) => u.vp.tag === '390')).toBe(true);
    expect(units.some((u) => u.phase === 'A')).toBe(true);
    expect(units.some((u) => u.phase === 'B')).toBe(true);
  });

  it('--game selects phase B only', () => {
    const units = select({ game: ['durak'] });
    expect(units.every((u) => u.phase === 'B' && u.game.tag === 'durak')).toBe(true);
    expect(units).toHaveLength(VIEWPORTS.length * DIRS.length);
  });

  it('--dir selects phase B only', () => {
    const units = select({ dir: ['rtl'] });
    expect(units.every((u) => u.phase === 'B' && u.dir === 'rtl')).toBe(true);
  });

  it('--scenario selects phase A only', () => {
    const units = select({ scenario: ['collapsed'] });
    expect(units.every((u) => u.phase === 'A' && u.scenario.name === 'collapsed')).toBe(true);
    expect(units).toHaveLength(VIEWPORTS.length);
  });

  it('--act selects behaviour only, and skips the geometry block', () => {
    const units = select({ act: ['sticker'] });
    expect(units.every((u) => u.phase === 'B' && u.actsOnly === true)).toBe(true);
    expect(units.every((u) => u.acts.length === 1 && u.acts[0] === 'sticker')).toBe(true);
    // `sticker` only belongs to the full set, which is 390 ltr.
    expect(units.every((u) => u.vp.tag === '390' && u.dir === 'ltr')).toBe(true);
    expect(units.map((u) => u.game.tag)).toEqual(['durak', 'poker']);
  });
});

describe('selectMatrix — filters compose', () => {
  it('viewport + game + dir + act reduce to a single behaviour run', () => {
    const units = select({ viewport: ['390'], game: ['durak'], dir: ['ltr'], act: ['typing-caret'] });
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ phase: 'B', dir: 'ltr', actsOnly: true, acts: ['typing-caret'] });
    expect(units[0].vp.tag).toBe('390');
    expect(units[0].game.tag).toBe('durak');
  });

  it('viewport + scenario reduce to a single phase A run', () => {
    const units = select({ viewport: ['360'], scenario: ['chat'] });
    expect(units).toHaveLength(1);
    expect(units[0].name).toBe('360 inflow/chat');
  });

  it('--act NARROWS the default set and never widens it', () => {
    // 360 runs the core pair only. Asking for `combined` there selects nothing rather than
    // inventing coverage the full run does not have.
    expect(select({ viewport: ['360'], act: ['combined'] })).toHaveLength(0);
    expect(select({ viewport: ['360'], act: ['typing-caret'] }).length).toBeGreaterThan(0);
    // A game with no legal action has no behaviour set at any width.
    expect(select({ game: ['king'], act: ['typing-caret'] })).toHaveLength(0);
  });

  it('contradictory filters select nothing instead of quietly dropping one', () => {
    expect(select({ game: ['durak'], scenario: ['collapsed'] })).toHaveLength(0);
  });
});

describe('phasesFor', () => {
  it('maps each filter to the phase it belongs to', () => {
    expect(phasesFor({})).toEqual({ runA: true, runB: true });
    expect(phasesFor({ viewport: ['390'] })).toEqual({ runA: true, runB: true });
    expect(phasesFor({ game: ['durak'] })).toEqual({ runA: false, runB: true });
    expect(phasesFor({ dir: ['ltr'] })).toEqual({ runA: false, runB: true });
    expect(phasesFor({ act: ['sticker'] })).toEqual({ runA: false, runB: true });
    expect(phasesFor({ scenario: ['chat'] })).toEqual({ runA: true, runB: false });
  });
});

describe('the legacy --only still works, and is no longer allowed to pass on nothing', () => {
  it('matches scenario and game names as a substring', () => {
    expect(select({}, 'collapsed').every((u) => u.phase === 'A' && u.scenario.name === 'collapsed')).toBe(true);
    expect(select({}, 'durak/ltr').every((u) => u.phase === 'B' && u.game.tag === 'durak' && u.dir === 'ltr')).toBe(true);
  });

  it('selects NOTHING for a viewport — the bug that made focused runs meaningless', () => {
    expect(select({}, '390')).toHaveLength(0);
    // …which is precisely why `--viewport` had to exist as its own axis.
    expect(select({ viewport: ['390'] }).length).toBeGreaterThan(0);
  });
});

describe('reporting', () => {
  it('summarise names the actual selection, not the request', () => {
    const filters = { viewport: ['390'], game: ['durak'], dir: ['ltr'], act: ['typing-caret'] };
    const lines = summarise(select(filters), filters).join('\n');
    expect(lines).toContain('--viewport 390');
    expect(lines).toContain('phase A (variant harness): 0');
    expect(lines).toContain('phase B (real branches):   1');
    expect(lines).toContain('behaviour actions:         1 — typing-caret');
    expect(lines).toContain('geometry blocks are skipped');
  });

  it('summarise says FULL when nothing was filtered', () => {
    expect(summarise(select({}), {}).join('\n')).toContain('FULL (no filters)');
  });

  it('the empty-selection message names the axis and the known values', () => {
    const msg = emptySelectionError({ viewport: ['999'] }, CAT);
    expect(msg).toContain('selected 0 checks');
    expect(msg).toContain('must fail, not pass');
    expect(msg).toContain('360, 390, 1366');
  });
});
