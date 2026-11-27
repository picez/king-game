// S4 — every guide step is a real, legal position and its expected move is legal.
import { describe, expect, it } from 'vitest';
import { buildTutorials } from './tutorials';
import { engineFor } from './registry';
import { SOLITAIRE_IDS } from './engine';
import { tap, type TapTarget } from './tap';
import type { PileState } from './pileKit';
import { EN } from '../i18n/dictionaries/en';
import { UK } from '../i18n/dictionaries/uk';

describe('solitaire guides', () => {
  const all = buildTutorials();

  it('one guide per solitaire, each with an intro and at least two practice moves', () => {
    expect(all.map((t) => t.id).sort()).toEqual([...SOLITAIRE_IDS].sort());
    for (const t of all) {
      expect(t.steps[0].expect).toBeUndefined();
      expect(t.steps.filter((s) => s.expect).length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(buildTutorials().map((t) => [t.id, t] as const))('%s: each expected move is legal and reachable by a tap', (_id, t) => {
    const e = engineFor(t.key);
    for (const st of t.steps) {
      if (!st.expect) continue;
      expect(e.legal(st.state).some((m) => JSON.stringify(m) === JSON.stringify(st.expect)), `${st.textKey} ${JSON.stringify(st.expect)}`).toBe(true);
      expect(e.apply(st.state, st.expect)).not.toBeNull();
      // The tap the learner makes on the highlighted card produces exactly that move.
      const m = st.expect;
      let target: TapTarget;
      if (m.t === 'stock') target = { kind: 'stock' };
      else if (m.t === 'remove') target = { kind: 'card', id: m.ids[0] };
      else if (m.t === 'play') target = { kind: 'card', id: m.id };
      else if (m.t === 'pass') continue;
      else target = { kind: 'pile', pile: m.from, index: (st.state as PileState).piles[m.from].length - m.n };
      let r = tap(t.id, e, st.state, null, target);
      if (!r.move && r.selection && m.t === 'remove' && m.ids[1] !== undefined) r = tap(t.id, e, st.state, r.selection, { kind: 'card', id: m.ids[1] });
      if (!r.move && r.selection && m.t === 'move') r = tap(t.id, e, st.state, r.selection, { kind: 'pile', pile: m.to, index: null });
      expect(JSON.stringify(r.move), st.textKey).toBe(JSON.stringify(m));
    }
  });

  it('every caption exists in English and Ukrainian', () => {
    for (const t of all) for (const st of t.steps) {
      expect(EN[st.textKey], st.textKey).toBeTruthy();
      expect(UK[st.textKey], st.textKey).toBeTruthy();
    }
  });
});
