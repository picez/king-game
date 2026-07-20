// ---------------------------------------------------------------------------
// King scripted tutorial (Stage 31.2). 6 steps, ≤120 s. Pure deterministic scenes
// + i18n caption keys. Mirrors TUTORIALS_PLAN.md §3.1 + KING_RULES.md essentials.
// No engine/reducer/server imports.
// ---------------------------------------------------------------------------

import type { Tutorial, TutorialCardFace, TutorialSeat, TutorialTrickCard } from './types';

const c = (id: string, suit: TutorialCardFace['suit'], rank: TutorialCardFace['rank']): TutorialCardFace =>
  ({ id, suit, rank });
const tc = (id: string, card: TutorialCardFace, extra: Partial<TutorialTrickCard> = {}): TutorialTrickCard =>
  ({ id, card, ...extra });

const RIVAL: TutorialSeat = { id: 's.opp', pos: 'top', nameKey: 'tutorial.seat.rival' };
const ME: TutorialSeat = { id: 's.me', pos: 'bottom', nameKey: 'tutorial.seat.you', isMe: true };

export const kingTutorial: Tutorial = {
  id: 'king',
  enabled: true,
  learnKey: 'tutorial.king.learn',
  steps: [
    {
      id: 'goal',
      titleKey: 'tutorial.king.goal.title',
      bodyKey: 'tutorial.king.goal.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.win', text: '↓ lowest total wins', tone: 'good' }],
        hand: [c('h1', 'spades', 'K'), c('h2', 'hearts', 'Q'), c('h3', 'diamonds', '10'), c('h4', 'clubs', '7'), c('h5', 'spades', '9')],
      },
      highlight: [{ targetId: 'zone.win', pulse: true }],
    },
    {
      id: 'follow',
      titleKey: 'tutorial.king.follow.title',
      bodyKey: 'tutorial.king.follow.body',
      estimatedSeconds: 18,
      scene: {
        layout: 'trick',
        seats: [RIVAL, ME],
        trick: [tc('t.lead', c('tl', 'spades', '9'), { lead: true })],
        hand: [c('h.as', 'spades', 'A'), c('h.7s', 'spades', '7'), c('h.qh', 'hearts', 'Q'), c('h.10d', 'diamonds', '10')],
      },
      highlight: [{ targetId: 'tl', pulse: true }, { targetId: 'h.as' }, { targetId: 'h.7s' }],
    },
    {
      id: 'wins',
      titleKey: 'tutorial.king.wins.title',
      bodyKey: 'tutorial.king.wins.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'trick',
        seats: [RIVAL, ME],
        trick: [
          tc('t.9', c('t9', 'spades', '9'), { lead: true }),
          tc('t.k', c('tk', 'spades', 'K')),
          tc('t.a', c('ta', 'spades', 'A'), { winner: true }),
        ],
      },
      highlight: [{ targetId: 'ta', pulse: true }],
    },
    {
      id: 'modes',
      titleKey: 'tutorial.king.modes.title',
      bodyKey: 'tutorial.king.modes.body',
      estimatedSeconds: 18,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.m1', text: '🚫 tricks', tone: 'bad' },
          { id: 'zone.m2', text: '♥ ✗', tone: 'bad' },
          { id: 'zone.m3', text: 'Q ✗', tone: 'bad' },
          { id: 'zone.m4', text: '♠ Trump +', tone: 'good' },
        ],
      },
      highlight: [{ targetId: 'zone.m4', pulse: true }],
    },
    {
      id: 'scoring',
      titleKey: 'tutorial.king.scoring.title',
      bodyKey: 'tutorial.king.scoring.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.neg', text: 'negative round = −', tone: 'bad' },
          { id: 'zone.pos', text: 'Trump round = +', tone: 'good' },
        ],
      },
      highlight: [{ targetId: 'zone.neg' }, { targetId: 'zone.pos' }],
    },
    {
      id: 'endgame',
      titleKey: 'tutorial.king.endgame.title',
      bodyKey: 'tutorial.king.endgame.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.you', text: 'You 12', tone: 'good' },
          { id: 'zone.rival', text: 'Rival 30', tone: 'default' },
          { id: 'zone.win', text: '↓ lowest wins', tone: 'good' },
        ],
      },
      highlight: [{ targetId: 'zone.you', pulse: true }, { targetId: 'zone.win' }],
    },
  ],
};
