// ---------------------------------------------------------------------------
// Tarneeb scripted tutorial (Stage 31.2). 6 steps, ≤120 s. Pure deterministic
// scenes + i18n caption keys. Mirrors TUTORIALS_PLAN.md §3.4 + TARNEEB_RULES.md
// (bid 3–13, exact = ×2, over = actual, miss = penalty, configurable target). No
// engine imports.
// ---------------------------------------------------------------------------

import type { Tutorial, TutorialCardFace, TutorialSeat, TutorialTrickCard } from './types';

const c = (id: string, suit: TutorialCardFace['suit'], rank: TutorialCardFace['rank']): TutorialCardFace =>
  ({ id, suit, rank });
const tc = (id: string, card: TutorialCardFace, extra: Partial<TutorialTrickCard> = {}): TutorialTrickCard =>
  ({ id, card, ...extra });

const YOU: TutorialSeat = { id: 's.me', pos: 'bottom', nameKey: 'tutorial.seat.you', isMe: true };
const PARTNER: TutorialSeat = { id: 's.partner', pos: 'top', nameKey: 'tutorial.seat.partner' };
const RIVAL_L: TutorialSeat = { id: 's.rl', pos: 'left', nameKey: 'tutorial.seat.rival' };
const RIVAL_R: TutorialSeat = { id: 's.rr', pos: 'right', nameKey: 'tutorial.seat.rival' };

export const tarneebTutorial: Tutorial = {
  id: 'tarneeb',
  enabled: true,
  learnKey: 'tutorial.tarneeb.learn',
  steps: [
    {
      id: 'overview',
      titleKey: 'tutorial.tarneeb.overview.title',
      bodyKey: 'tutorial.tarneeb.overview.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        seats: [YOU, PARTNER, RIVAL_L, RIVAL_R],
        chips: [{ id: 'zone.pairs', text: 'Pairs · 2×2' }, { id: 'zone.solo', text: 'Solo' }],
      },
      highlight: [{ targetId: 's.partner', pulse: true }, { targetId: 'zone.pairs' }],
    },
    {
      id: 'bidding',
      titleKey: 'tutorial.tarneeb.bidding.title',
      bodyKey: 'tutorial.tarneeb.bidding.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.b1', text: 'You: 7', tone: 'good' }, { id: 'zone.b2', text: 'Rival: pass' }],
        hand: [c('h1', 'spades', 'A'), c('h2', 'spades', 'K'), c('h3', 'spades', 'Q'), c('h4', 'hearts', 'A'), c('h5', 'clubs', '10')],
      },
      highlight: [{ targetId: 'zone.b1', pulse: true }],
    },
    {
      id: 'trump',
      titleKey: 'tutorial.tarneeb.trump.title',
      bodyKey: 'tutorial.tarneeb.trump.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        trump: 'spades',
        chips: [{ id: 'zone.tb', text: 'top bidder → ♠ + leads' }],
        hand: [c('h1', 'spades', 'A'), c('h2', 'spades', 'K'), c('h3', 'spades', 'Q'), c('h4', 'hearts', 'A')],
      },
      highlight: [{ targetId: 'zone.trump', pulse: true }],
    },
    {
      id: 'follow',
      titleKey: 'tutorial.tarneeb.follow.title',
      bodyKey: 'tutorial.tarneeb.follow.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'trick',
        trump: 'spades',
        seats: [{ ...RIVAL_L }, YOU],
        trick: [tc('t.lead', c('tl', 'hearts', '9'), { lead: true })],
        hand: [c('h.ah', 'hearts', 'A'), c('h.7h', 'hearts', '7'), c('h.kd', 'diamonds', 'K')],
      },
      highlight: [{ targetId: 'tl', pulse: true }, { targetId: 'h.ah' }, { targetId: 'h.7h' }],
    },
    {
      id: 'obligation',
      titleKey: 'tutorial.tarneeb.obligation.title',
      bodyKey: 'tutorial.tarneeb.obligation.body',
      estimatedSeconds: 18,
      scene: {
        layout: 'trick',
        trump: 'spades',
        chips: [{ id: 'zone.void', text: 'void → trump wins', tone: 'good' }],
        trick: [tc('t.lead', c('tl', 'hearts', 'A'), { lead: true }), tc('t.win', c('tw', 'spades', '2'), { winner: true })],
        hand: [c('h.2s', 'spades', '2'), c('h.kd', 'diamonds', 'K'), c('h.5c', 'clubs', '5')],
      },
      highlight: [{ targetId: 'tw', pulse: true }, { targetId: 'zone.void' }],
    },
    {
      id: 'scoring',
      titleKey: 'tutorial.tarneeb.scoring.title',
      bodyKey: 'tutorial.tarneeb.scoring.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.exact', text: 'exact = ×2', tone: 'good' },
          { id: 'zone.over', text: 'over = tricks' },
          { id: 'zone.miss', text: 'miss = −', tone: 'bad' },
          { id: 'zone.target', text: 'target 41' },
        ],
      },
      highlight: [{ targetId: 'zone.exact', pulse: true }],
    },
  ],
};
