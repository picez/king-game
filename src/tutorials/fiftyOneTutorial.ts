// ---------------------------------------------------------------------------
// 51 (Syrian 51) scripted tutorial (Stage 31.1). 7 steps, ≤120 s. Pure data —
// deterministic scene snapshots + i18n caption keys. Mirrors the outline in
// TUTORIALS_PLAN.md §3.6. No engine/reducer/server imports.
// ---------------------------------------------------------------------------

import type { Tutorial, TutorialCardFace } from './types';

const c = (id: string, suit: TutorialCardFace['suit'], rank: TutorialCardFace['rank']): TutorialCardFace =>
  ({ id, suit, rank });
const joker = (id: string, represents?: TutorialCardFace['represents']): TutorialCardFace =>
  ({ id, joker: true, represents });

export const fiftyOneTutorial: Tutorial = {
  id: 'fifty-one',
  enabled: true,
  learnKey: 'tutorial.fifty-one.learn',
  steps: [
    // 1 — Goal
    {
      id: 'goal',
      titleKey: 'tutorial.fifty-one.goal.title',
      bodyKey: 'tutorial.fifty-one.goal.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.elim', text: '☠ 510', tone: 'bad' }],
        hand: [c('h1', 'spades', 'K'), c('h2', 'hearts', 'K'), c('h3', 'diamonds', 'K'),
          c('h4', 'spades', '5'), c('h5', 'spades', '6'), c('h6', 'spades', '7'), joker('h7')],
      },
      highlight: [{ targetId: 'zone.elim', pulse: true }],
    },
    // 2 — Draw → discard turn
    {
      id: 'turn',
      titleKey: 'tutorial.fifty-one.turn.title',
      bodyKey: 'tutorial.fifty-one.turn.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'meld',
        drawCount: 24,
        discardTop: c('disc', 'clubs', '8'),
        hand: [c('h1', 'spades', 'K'), c('h2', 'hearts', 'K'), c('h3', 'diamonds', 'K'),
          c('h4', 'spades', '5'), c('h5', 'spades', '6'), c('h6', 'spades', '7')],
      },
      highlight: [{ targetId: 'zone.draw', pulse: true }, { targetId: 'zone.discard' }],
    },
    // 3 — Open with 51 (once per round)
    {
      id: 'open51',
      titleKey: 'tutorial.fifty-one.open51.title',
      bodyKey: 'tutorial.fifty-one.open51.body',
      estimatedSeconds: 18,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.total', text: '= 65 · ≥ 51 ✓', tone: 'good' }],
        melds: [
          { id: 'm.aces', cards: [c('a1', 'spades', 'A'), c('a2', 'hearts', 'A'), c('a3', 'diamonds', 'A')] }, // 30
          { id: 'm.run', cards: [c('r5', 'spades', '5'), c('r6', 'spades', '6'), c('r7', 'spades', '7'), c('r8', 'spades', '8'), c('r9', 'spades', '9')] }, // 35
        ],
        hand: [c('h1', 'clubs', 'K'), c('h2', 'hearts', '4'), c('h3', 'diamonds', '9')],
      },
      highlight: [{ targetId: 'm.aces' }, { targetId: 'm.run' }, { targetId: 'zone.total', pulse: true }],
    },
    // 4 — Discard-to-open exception
    {
      id: 'discardOpen',
      titleKey: 'tutorial.fifty-one.discardOpen.title',
      bodyKey: 'tutorial.fifty-one.discardOpen.body',
      actionHintKey: 'tutorial.fifty-one.discardOpen.hint',
      estimatedSeconds: 17,
      scene: {
        layout: 'meld',
        discardTop: c('disc', 'spades', '4'),
        chips: [{ id: 'zone.take', text: 'Take & open 51', tone: 'gold' }],
        hand: [c('h1', 'spades', '5'), c('h2', 'spades', '6'), c('h3', 'hearts', 'A'), c('h4', 'diamonds', 'A'), c('h5', 'clubs', 'A')],
      },
      highlight: [{ targetId: 'zone.discard', pulse: true }, { targetId: 'zone.take' }],
    },
    // 5 — Runs & sets (A-2-3, Q-K-A; K-A-2 invalid) + lay off
    {
      id: 'melds',
      titleKey: 'tutorial.fifty-one.melds.title',
      bodyKey: 'tutorial.fifty-one.melds.body',
      estimatedSeconds: 18,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.bad', text: 'K-A-2 ✗', tone: 'bad' }],
        melds: [
          { id: 'm.low', cards: [c('l1', 'hearts', 'A'), c('l2', 'hearts', '2'), c('l3', 'hearts', '3')] },  // A-2-3
          { id: 'm.high', cards: [c('g1', 'clubs', 'Q'), c('g2', 'clubs', 'K'), c('g3', 'clubs', 'A')] },     // Q-K-A
        ],
        hand: [c('h1', 'hearts', '4'), c('h2', 'spades', '9')],
      },
      highlight: [{ targetId: 'm.low' }, { targetId: 'm.high' }, { targetId: 'zone.bad', pulse: true }],
    },
    // 6 — Jokers (in-meld value + replacement + 25 in hand)
    {
      id: 'joker',
      titleKey: 'tutorial.fifty-one.joker.title',
      bodyKey: 'tutorial.fifty-one.joker.body',
      actionHintKey: 'tutorial.fifty-one.joker.hint',
      estimatedSeconds: 18,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.jhand', text: '🃏 in hand = 25', tone: 'bad' }],
        melds: [
          { id: 'm.jok', cards: [c('j1', 'diamonds', '7'), joker('j2', { suit: 'diamonds', rank: '8' }), c('j3', 'diamonds', '9')] },
        ],
        hand: [c('h1', 'diamonds', '8'), joker('h2')],
      },
      highlight: [{ targetId: 'j2', pulse: true }, { targetId: 'h1' }],
    },
    // 7 — Round scoring / elimination
    {
      id: 'scoring',
      titleKey: 'tutorial.fifty-one.scoring.title',
      bodyKey: 'tutorial.fifty-one.scoring.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.you', text: 'You 0', tone: 'good' },
          { id: 'zone.r1', text: 'Rival 100', tone: 'default' },
          { id: 'zone.elim', text: '☠ 510', tone: 'bad' },
        ],
        hand: [],
      },
      highlight: [{ targetId: 'zone.elim', pulse: true }],
    },
  ],
};
