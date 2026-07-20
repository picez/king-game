// ---------------------------------------------------------------------------
// Deberc scripted tutorial (Stage 31.2). 7 steps, ≤120 s. Pure deterministic
// scenes + i18n caption keys. Mirrors TUTORIALS_PLAN.md §3.3 + the v1.6 rule fixes
// (length-first Палтіна, restricted trump exchange, бела-on-play). Chip text is
// symbolic; the word "Палтіна" lives only in the i18n captions. No engine imports.
// ---------------------------------------------------------------------------

import type { Tutorial, TutorialCardFace, TutorialTrickCard } from './types';

const c = (id: string, suit: TutorialCardFace['suit'], rank: TutorialCardFace['rank']): TutorialCardFace =>
  ({ id, suit, rank });
const tc = (id: string, card: TutorialCardFace, extra: Partial<TutorialTrickCard> = {}): TutorialTrickCard =>
  ({ id, card, ...extra });

export const debercTutorial: Tutorial = {
  id: 'deberc',
  enabled: true,
  learnKey: 'tutorial.deberc.learn',
  steps: [
    {
      id: 'modes',
      titleKey: 'tutorial.deberc.modes.title',
      bodyKey: 'tutorial.deberc.modes.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.solo', text: 'Solo · 3' }, { id: 'zone.pairs', text: 'Pairs · 4' }],
        hand: [c('h1', 'clubs', 'A'), c('h2', 'clubs', 'K'), c('h3', 'hearts', '9'), c('h4', 'spades', '10'), c('h5', 'diamonds', 'J')],
      },
      highlight: [{ targetId: 'zone.solo' }, { targetId: 'zone.pairs' }],
    },
    {
      id: 'trump',
      titleKey: 'tutorial.deberc.trump.title',
      bodyKey: 'tutorial.deberc.trump.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'trick',
        trump: 'clubs',
        chips: [{ id: 'zone.bid', text: 'bid on 6 cards' }],
        trick: [tc('t.tt', c('tt', 'clubs', '10'))],
        hand: [c('h1', 'clubs', 'A'), c('h2', 'clubs', '7'), c('h3', 'hearts', '9'), c('h4', 'spades', '10')],
      },
      highlight: [{ targetId: 'tt', pulse: true }, { targetId: 'zone.trump' }],
    },
    {
      id: 'combos',
      titleKey: 'tutorial.deberc.combos.title',
      bodyKey: 'tutorial.deberc.combos.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.terce', text: 'Terce 20' }, { id: 'zone.palt', text: '50' }],
        melds: [
          { id: 'm.terce', cards: [c('e1', 'spades', '9'), c('e2', 'spades', '10'), c('e3', 'spades', 'J')] },
          { id: 'm.palt', cards: [c('p1', 'hearts', '7'), c('p2', 'hearts', '8'), c('p3', 'hearts', '9'), c('p4', 'hearts', '10')] },
        ],
      },
      highlight: [{ targetId: 'm.terce' }, { targetId: 'm.palt', pulse: true }],
    },
    {
      id: 'length',
      titleKey: 'tutorial.deberc.length.title',
      bodyKey: 'tutorial.deberc.length.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.len', text: '5 > 4 · length first', tone: 'good' }],
        melds: [
          { id: 'm.p5', cards: [c('a1', 'spades', '5'), c('a2', 'spades', '6'), c('a3', 'spades', '7'), c('a4', 'spades', '8'), c('a5', 'spades', '9')] },
          { id: 'm.p4', cards: [c('b1', 'hearts', 'J'), c('b2', 'hearts', 'Q'), c('b3', 'hearts', 'K'), c('b4', 'hearts', 'A')] },
        ],
      },
      highlight: [{ targetId: 'm.p5', pulse: true }, { targetId: 'zone.len' }],
    },
    {
      id: 'exchange',
      titleKey: 'tutorial.deberc.exchange.title',
      bodyKey: 'tutorial.deberc.exchange.body',
      actionHintKey: 'tutorial.deberc.exchange.hint',
      estimatedSeconds: 17,
      scene: {
        layout: 'trick',
        trump: 'clubs',
        chips: [{ id: 'zone.swap', text: '7♣ ↔ 10♣', tone: 'gold' }],
        trick: [tc('t.tt', c('tt', 'clubs', '10'))],
        hand: [c('h.7c', 'clubs', '7'), c('h2', 'hearts', 'K'), c('h3', 'spades', 'A')],
      },
      highlight: [{ targetId: 'h.7c', pulse: true }, { targetId: 'tt' }, { targetId: 'zone.swap' }],
    },
    {
      id: 'bela',
      titleKey: 'tutorial.deberc.bela.title',
      bodyKey: 'tutorial.deberc.bela.body',
      estimatedSeconds: 18,
      scene: {
        layout: 'trick',
        trump: 'clubs',
        chips: [{ id: 'zone.bela', text: '🔔 Bela +20 if won', tone: 'gold' }],
        trick: [tc('t.k', c('k.c', 'clubs', 'K'), { winner: true }), tc('t.9', c('n.d', 'diamonds', '9'))],
        hand: [c('h.q', 'clubs', 'Q'), c('h2', 'spades', '8')],
      },
      highlight: [{ targetId: 'k.c', pulse: true }, { targetId: 'zone.bela' }],
    },
    {
      id: 'scoring',
      titleKey: 'tutorial.deberc.scoring.title',
      bodyKey: 'tutorial.deberc.scoring.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.last', text: 'last trick +10', tone: 'good' }, { id: 'zone.tot', text: 'cards + melds' }],
      },
      highlight: [{ targetId: 'zone.last', pulse: true }],
    },
  ],
};
