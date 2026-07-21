// ---------------------------------------------------------------------------
// Poker (No-Limit Texas Hold'em) scripted tutorial (Stage 37.4). 7 steps, ≤120 s.
// Pure data — deterministic scene snapshots + i18n caption keys. Mirrors the
// outline in POKER_RULES.md. No engine/reducer/server imports.
// ---------------------------------------------------------------------------

import type { Tutorial, TutorialCardFace } from './types';

const c = (id: string, suit: TutorialCardFace['suit'], rank: TutorialCardFace['rank']): TutorialCardFace =>
  ({ id, suit, rank });

export const pokerTutorial: Tutorial = {
  id: 'poker',
  enabled: true,
  learnKey: 'tutorial.poker.learn',
  steps: [
    // 1 — Goal: 2 hole cards + shared board; win all the chips.
    {
      id: 'goal',
      titleKey: 'tutorial.poker.goal.title',
      bodyKey: 'tutorial.poker.goal.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.pot', text: '💰 1000', tone: 'gold' }],
        melds: [{ id: 'board', cards: [c('b1', 'spades', 'A'), c('b2', 'spades', 'K'), c('b3', 'hearts', '7'), c('b4', 'clubs', '2'), c('b5', 'diamonds', '9')] }],
        hand: [c('h1', 'spades', 'A'), c('h2', 'hearts', 'A')],
      },
      highlight: [{ targetId: 'board' }, { targetId: 'zone.pot', pulse: true }],
    },
    // 2 — Blinds & button.
    {
      id: 'blinds',
      titleKey: 'tutorial.poker.blinds.title',
      bodyKey: 'tutorial.poker.blinds.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.btn', text: 'D', tone: 'gold' },
          { id: 'zone.sb', text: 'SB 10', tone: 'default' },
          { id: 'zone.bb', text: 'BB 20', tone: 'default' },
        ],
        hand: [c('h1', 'clubs', 'K'), c('h2', 'diamonds', 'Q')],
      },
      highlight: [{ targetId: 'zone.btn', pulse: true }, { targetId: 'zone.sb' }, { targetId: 'zone.bb' }],
    },
    // 3 — Betting actions.
    {
      id: 'actions',
      titleKey: 'tutorial.poker.actions.title',
      bodyKey: 'tutorial.poker.actions.body',
      actionHintKey: 'tutorial.poker.actions.hint',
      estimatedSeconds: 17,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.fold', text: 'Fold', tone: 'bad' },
          { id: 'zone.call', text: 'Call', tone: 'default' },
          { id: 'zone.raise', text: 'Raise', tone: 'good' },
          { id: 'zone.allin', text: 'All-in', tone: 'gold' },
        ],
        hand: [c('h1', 'hearts', 'J'), c('h2', 'hearts', '10')],
      },
      highlight: [{ targetId: 'zone.raise', pulse: true }, { targetId: 'zone.allin' }],
    },
    // 4 — Streets: flop, turn, river.
    {
      id: 'streets',
      titleKey: 'tutorial.poker.streets.title',
      bodyKey: 'tutorial.poker.streets.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.flop', text: 'Flop 3 · Turn 1 · River 1', tone: 'default' }],
        melds: [{ id: 'board', cards: [c('b1', 'spades', '10'), c('b2', 'hearts', 'J'), c('b3', 'diamonds', 'Q'), c('b4', 'clubs', '3'), c('b5', 'spades', '8')] }],
        hand: [c('h1', 'clubs', 'A'), c('h2', 'spades', 'K')],
      },
      highlight: [{ targetId: 'board' }, { targetId: 'zone.flop', pulse: true }],
    },
    // 5 — Showdown & rankings (best 5 of 7).
    {
      id: 'showdown',
      titleKey: 'tutorial.poker.showdown.title',
      bodyKey: 'tutorial.poker.showdown.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'meld',
        chips: [{ id: 'zone.rank', text: '♠A ♠K ♠Q ♠J ♠10 — Royal!', tone: 'gold' }],
        melds: [{ id: 'board', cards: [c('b1', 'spades', 'Q'), c('b2', 'spades', 'J'), c('b3', 'spades', '10'), c('b4', 'hearts', '3'), c('b5', 'clubs', '4')] }],
        hand: [c('h1', 'spades', 'A'), c('h2', 'spades', 'K')],
      },
      highlight: [{ targetId: 'zone.rank', pulse: true }],
    },
    // 6 — All-in, side pots and winning without a showdown.
    {
      id: 'allin',
      titleKey: 'tutorial.poker.allin.title',
      bodyKey: 'tutorial.poker.allin.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.main', text: 'Main pot', tone: 'good' },
          { id: 'zone.side', text: 'Side pot', tone: 'default' },
          { id: 'zone.fold', text: 'All fold → you win', tone: 'gold' },
        ],
        hand: [c('h1', 'diamonds', 'A'), c('h2', 'clubs', 'A')],
      },
      highlight: [{ targetId: 'zone.side', pulse: true }, { targetId: 'zone.fold' }],
    },
    // 7 — Privacy & handover.
    {
      id: 'privacy',
      titleKey: 'tutorial.poker.privacy.title',
      bodyKey: 'tutorial.poker.privacy.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.priv', text: '🔒 Hole cards private', tone: 'good' }],
        hand: [c('h1', 'hearts', 'K'), c('h2', 'spades', '9')],
      },
      highlight: [{ targetId: 'zone.priv', pulse: true }],
    },
  ],
};
