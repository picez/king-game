// ---------------------------------------------------------------------------
// Solitaire guides (S4): short interactive lessons on the REAL boards and
// engines. Each step is a small hand-made position; a step with `expect` waits
// for the learner to play exactly that move (the board highlights it), a step
// without one just explains and shows "Next". Pure data + builders.
// ---------------------------------------------------------------------------

import type { Suit } from '../models/types';
import type { SCard } from './cards';
import type { Move, SolitaireId, VariantKey } from './engine';
import type { PileState } from './pileKit';
import { pyramidExposed, type PyramidState } from './pyramid';
import type { TriPeaksState } from './triPeaks';
import type { HeartsState } from './hearts';

export interface TutorialStep {
  /** i18n key of the caption. */
  textKey: string;
  state: unknown;
  /** The move the learner must play; absent = an explanation step. */
  expect?: Move;
}

export interface SolitaireTutorial { id: SolitaireId; key: VariantKey; steps: TutorialStep[] }

// ── card notation: 'H7' = 7♥ face up, '_S9' = 9♠ face down; A J Q K = 1 11 12 13 ──
const SUIT: Record<string, Suit> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };
let nextId = 1000;
export function card(code: string): SCard {
  const down = code.startsWith('_');
  const c = down ? code.slice(1) : code;
  const suit = SUIT[c[0]];
  const r = c.slice(1);
  return { id: nextId++, suit, rank: RANK[r] ?? Number(r), up: !down };
}
const cards = (codes: string) => (codes.trim() ? codes.trim().split(/\s+/).map(card) : []);

/** A full pile state for a variant layout with the given piles filled in. */
function piles(ids: string[], fill: Record<string, string>): PileState {
  const p: PileState['piles'] = {};
  for (const id of ids) p[id] = cards(fill[id] ?? '');
  return { piles: p, passes: 0 };
}
const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const KLONDIKE = ['s', 'w', ...range('f', 4), ...range('t', 7)];
const SPIDER = ['s', ...range('f', 8), ...range('t', 10)];
const FREECELL = [...range('c', 4), ...range('f', 4), ...range('t', 8)];
const YUKON = [...range('f', 4), ...range('t', 7)];
const FORTY = ['s', 'w', ...range('f', 8), ...range('t', 10)];

function board28(fill: Record<number, string>): (SCard | null)[] {
  return Array.from({ length: 28 }, (_, i) => (fill[i] ? card(fill[i]) : null));
}

const mv = (from: string, to: string, n = 1): Move => ({ t: 'move', from, n, to });

/**
 * A Hearts position mid-hand: seats 1–3 have played `trick` (in order), it is your
 * turn; each bot keeps a few low clubs so the game can go on after your card.
 */
let heartsCards: Record<string, number> = {};
function heartsState(o: { hand: string; trick: string[] }): HeartsState {
  const hand = cards(o.hand);
  for (const c of hand) heartsCards[`${c.suit[0].toUpperCase()}${c.rank === 12 ? 'Q' : c.rank}`] = c.id;
  const trick = o.trick.map((code, i) => ({ seat: i + 1, card: card(code) }));
  const bot = () => cards('C3 C5 C8');
  return {
    hands: [hand, bot(), bot(), bot()], phase: 'play', hand: 0, trick, lastTrick: null,
    turn: trick.length === 0 ? 0 : (trick.length + 1) % 4, heartsBroken: false, trickNo: 5,
    taken: [0, 0, 0, 0], scores: [0, 0, 0, 0], moons: [0, 0, 0, 0], received: [], seed: 1,
  };
}
/** The play move of a card you were dealt in the PREVIOUS heartsState() call. */
const playOf = (code: string): Move => ({ t: 'play', id: heartsCards[code] });

export function buildTutorials(): SolitaireTutorial[] {
  nextId = 1000;
  heartsCards = {};
  const spiderFill = (extra: Record<string, string>) => {
    const f: Record<string, string> = {};
    for (let i = 0; i < 10; i++) f[`t${i}`] = 'SK';
    return { ...f, ...extra };
  };
  const pyr = (fill: Record<number, string>, stock = '', waste = ''): PyramidState => ({ board: board28(fill), stock: cards(stock).map((c) => ({ ...c, up: false })), waste: cards(waste), passes: 0 });
  const tri = (fill: Record<number, string>, waste: string, stock = '_C9 _D4'): TriPeaksState => ({ board: board28(fill), waste: cards(waste), stock: cards(stock) });

  const list: SolitaireTutorial[] = [
    {
      id: 'klondike', key: 'klondike-1', steps: [
        { textKey: 'solTut.klondike.goal', state: piles(KLONDIKE, { t0: 'S8', t1: '_C2 H7', t3: 'D5', s: '_C9 _D3' }) },
        { textKey: 'solTut.klondike.build', state: piles(KLONDIKE, { t0: 'S8', t1: '_C2 H7', t3: 'D5', s: '_C9 _D3' }), expect: mv('t1', 't0') },
        { textKey: 'solTut.klondike.ace', state: piles(KLONDIKE, { t0: 'S8 H7', t1: 'C2', w: 'DA', s: '_C9' }), expect: mv('w', 'f0') },
        { textKey: 'solTut.klondike.stock', state: piles(KLONDIKE, { t0: 'S8 H7', t1: 'C2', f0: 'DA', s: '_C9 _D3' }), expect: { t: 'stock' } },
        { textKey: 'solTut.klondike.king', state: piles(KLONDIKE, { t0: 'S8 H7', t2: '_D9 SK', s: '_C9' }), expect: mv('t2', 't1') },
      ],
    },
    {
      id: 'spider', key: 'spider-1', steps: [
        { textKey: 'solTut.spider.goal', state: piles(SPIDER, spiderFill({ t0: 'S9', t1: '_S4 S8', s: '_S2 _S3 _S4 _S5 _S6 _S7 _S8 _S9 _S10 _SJ' })) },
        { textKey: 'solTut.spider.build', state: piles(SPIDER, spiderFill({ t0: 'S9', t1: '_S4 S8', s: '_S2 _S3 _S4 _S5 _S6 _S7 _S8 _S9 _S10 _SJ' })), expect: mv('t1', 't0') },
        { textKey: 'solTut.spider.run', state: piles(SPIDER, spiderFill({ t0: 'SK SQ SJ S10 S9 S8 S7 S6 S5 S4 S3 S2', t1: '_S5 SA' })), expect: mv('t1', 't0') },
        { textKey: 'solTut.spider.deal', state: piles(SPIDER, spiderFill({ s: '_S2 _S3 _S4 _S5 _S6 _S7 _S8 _S9 _S10 _SJ' })), expect: { t: 'stock' } },
      ],
    },
    {
      id: 'freecell', key: 'freecell', steps: [
        { textKey: 'solTut.freecell.goal', state: piles(FREECELL, { t0: 'C5 HA', t1: 'D9', t2: 'S10 H9' }) },
        { textKey: 'solTut.freecell.ace', state: piles(FREECELL, { t0: 'C5 HA', t1: 'D9', t2: 'S10 H9' }), expect: mv('t0', 'f0') },
        { textKey: 'solTut.freecell.cell', state: piles(FREECELL, { t0: 'H2 C7', t1: 'D9', t2: 'S10 H9', t3: 'SK', t4: 'HK', t5: 'DK', t6: 'CK', t7: 'SQ', f0: 'HA' }), expect: mv('t0', 'c0') },
        { textKey: 'solTut.freecell.run', state: piles(FREECELL, { t0: 'D10', t1: 'SJ', t2: 'C9 H8', f0: 'HA' }), expect: mv('t2', 't0', 2) },
      ],
    },
    {
      id: 'pyramid', key: 'pyramid', steps: [
        { textKey: 'solTut.pyramid.goal', state: pyr({ 21: 'SK', 22: 'H6', 23: 'C7', 24: 'D3', 15: 'H10' }, '_C4 _D8', 'S2') },
        { textKey: 'solTut.pyramid.king', state: pyr({ 21: 'SK', 22: 'H6', 23: 'C7', 24: 'D3', 15: 'H10' }, '_C4 _D8', 'S2'), expect: { t: 'remove', ids: [] } },
        { textKey: 'solTut.pyramid.pair', state: pyr({ 22: 'H6', 23: 'C7', 24: 'D3', 16: 'H10' }, '_C4 _D8', 'S2'), expect: { t: 'remove', ids: [] } },
        { textKey: 'solTut.pyramid.waste', state: pyr({ 24: 'DJ', 17: 'H10' }, '_C4 _D8', 'S2'), expect: { t: 'remove', ids: [] } },
      ],
    },
    {
      id: 'tripeaks', key: 'tripeaks', steps: [
        { textKey: 'solTut.tripeaks.goal', state: tri({ 18: 'H6', 19: 'C8', 20: 'DK', 9: '_S5' }, 'S7') },
        { textKey: 'solTut.tripeaks.play', state: tri({ 18: 'H6', 19: 'C8', 20: 'DK', 9: '_S5' }, 'S7'), expect: { t: 'remove', ids: [] } },
        { textKey: 'solTut.tripeaks.wrap', state: tri({ 20: 'DK', 21: 'C4' }, 'HA'), expect: { t: 'remove', ids: [] } },
        { textKey: 'solTut.tripeaks.stock', state: tri({ 21: 'C4' }, 'HJ'), expect: { t: 'stock' } },
      ],
    },
    {
      id: 'yukon', key: 'yukon', steps: [
        { textKey: 'solTut.yukon.goal', state: piles(YUKON, { t0: 'S9', t1: '_D2 H8 C3 DQ', t2: '_C6 HK' }) },
        { textKey: 'solTut.yukon.move', state: piles(YUKON, { t0: 'S9', t1: '_D2 H8 C3 DQ', t2: '_C6 HK' }), expect: mv('t1', 't0', 3) },
        { textKey: 'solTut.yukon.king', state: piles(YUKON, { t0: 'S9 H8 C3 DQ', t1: 'D2', t2: '_C6 HK S5' }), expect: mv('t2', 't3', 2) },
      ],
    },
    {
      id: 'forty-thieves', key: 'forty-thieves', steps: [
        { textKey: 'solTut.forty.goal', state: piles(FORTY, { t0: 'C7 H9', t1: 'D4 H8', t2: 'SA', s: '_C3 _D6' }) },
        { textKey: 'solTut.forty.suit', state: piles(FORTY, { t0: 'C7 H9', t1: 'D4 H8', t2: 'SA', s: '_C3 _D6' }), expect: mv('t1', 't0') },
        { textKey: 'solTut.forty.ace', state: piles(FORTY, { t0: 'C7 H9 H8', t1: 'D4', t2: 'SA', s: '_C3 _D6' }), expect: mv('t2', 'f0') },
        { textKey: 'solTut.forty.stock', state: piles(FORTY, { t0: 'C7 H9 H8', t1: 'D4', f0: 'SA', s: '_C3 _D6' }), expect: { t: 'stock' } },
      ],
    },
    {
      id: 'hearts', key: 'hearts', steps: [
        { textKey: 'solTut.hearts.goal', state: heartsState({ hand: 'D2 S5 H7', trick: ['D9', 'D4', 'DQ'] }) },
        { textKey: 'solTut.hearts.follow', state: heartsState({ hand: 'D2 S5 H7', trick: ['D9', 'D4', 'DQ'] }), expect: playOf('D2') },
        { textKey: 'solTut.hearts.queen', state: heartsState({ hand: 'SQ H7 D5', trick: ['C9', 'C4', 'CK'] }), expect: playOf('SQ') },
        { textKey: 'solTut.hearts.lead', state: heartsState({ hand: 'H2 H9 C6', trick: [] }), expect: playOf('C6') },
      ],
    },
  ];
  return list.map(fillPairIds);
}

/** Pyramid / TriPeaks steps name their cards by position, resolved to ids here. */
function fillPairIds(t: SolitaireTutorial): SolitaireTutorial {
  const steps = t.steps.map((st) => {
    if (!st.expect || st.expect.t !== 'remove' || st.expect.ids.length) return st;
    const s = st.state as PyramidState | TriPeaksState;
    let ids: number[] = [];
    if (t.id === 'pyramid') {
      const king = s.board.find((c, i) => c && c.rank === 13 && pyramidExposed(s as PyramidState, i))?.id;
      if (king !== undefined) ids = [king];
      else {
        const w = s.waste[s.waste.length - 1];
        const open = s.board.filter((c, i): c is SCard => c !== null && pyramidExposed(s as PyramidState, i));
        const avail = [...open, ...(w ? [w] : [])];
        outer: for (let i = 0; i < avail.length; i++) for (let j = i + 1; j < avail.length; j++) {
          if (avail[i].rank + avail[j].rank === 13) { ids = [avail[i].id, avail[j].id]; break outer; }
        }
      }
    } else {
      const w = s.waste[s.waste.length - 1];
      const c = s.board.find((x) => x && x.up && (Math.abs(x.rank - w.rank) === 1 || Math.abs(x.rank - w.rank) === 12));
      if (c) ids = [c.id];
    }
    return { ...st, expect: { t: 'remove' as const, ids } };
  });
  return { ...t, steps };
}

export const tutorialFor = (id: SolitaireId): SolitaireTutorial => buildTutorials().find((t) => t.id === id)!;
