// ---------------------------------------------------------------------------
// Durak scripted tutorial (Stage 31.1). 6 steps, ≤120 s. Pure data — deterministic
// scene snapshots + i18n caption keys. Mirrors TUTORIALS_PLAN.md §3.2 + the owner's
// Stage 31.1 outline. Trump is hearts throughout. No engine/reducer/server imports.
// ---------------------------------------------------------------------------

import type { Tutorial, TutorialCardFace, TutorialSeat } from './types';

const c = (id: string, suit: TutorialCardFace['suit'], rank: TutorialCardFace['rank']): TutorialCardFace =>
  ({ id, suit, rank });

const OPP: TutorialSeat = { id: 's.opp', pos: 'top', nameKey: 'tutorial.seat.rival', roleKey: 'tutorial.role.attacker', handCount: 5 };
const ME: TutorialSeat = { id: 's.me', pos: 'bottom', nameKey: 'tutorial.seat.you', roleKey: 'tutorial.role.defender', isMe: true };

export const durakTutorial: Tutorial = {
  id: 'durak',
  enabled: true,
  learnKey: 'tutorial.durak.learn',
  steps: [
    // 1 — Goal
    {
      id: 'goal',
      titleKey: 'tutorial.durak.goal.title',
      bodyKey: 'tutorial.durak.goal.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        trump: 'hearts',
        seats: [OPP, ME],
        drawCount: 24,
        hand: [c('h1', 'spades', '6'), c('h2', 'spades', 'K'), c('h3', 'hearts', '9'), c('h4', 'clubs', '7'), c('h5', 'diamonds', '10')],
      },
      highlight: [{ targetId: 'zone.trump', pulse: true }],
    },
    // 2 — Attacker plays a card
    {
      id: 'attack',
      titleKey: 'tutorial.durak.attack.title',
      bodyKey: 'tutorial.durak.attack.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'trick',
        trump: 'hearts',
        seats: [OPP, ME],
        pairs: [{ id: 'p1', attack: c('a1', 'spades', '7') }],
        hand: [c('h1', 'spades', '6'), c('h2', 'spades', 'K'), c('h3', 'hearts', '9'), c('h4', 'clubs', '7'), c('h5', 'diamonds', '10')],
      },
      highlight: [{ targetId: 'a1', pulse: true }],
    },
    // 3 — Defender beats: higher same suit OR any trump
    {
      id: 'defend',
      titleKey: 'tutorial.durak.defend.title',
      bodyKey: 'tutorial.durak.defend.body',
      actionHintKey: 'tutorial.durak.defend.hint',
      estimatedSeconds: 20,
      scene: {
        layout: 'trick',
        trump: 'hearts',
        seats: [OPP, ME],
        pairs: [
          { id: 'p1', attack: c('a1', 'spades', '7'), defense: c('d1', 'spades', 'K'), beaten: true },   // higher same suit
          { id: 'p2', attack: c('a2', 'diamonds', '10'), defense: c('d2', 'hearts', '9'), beaten: true }, // trump beats non-trump
        ],
        hand: [c('h1', 'spades', '6'), c('h2', 'clubs', '7')],
      },
      highlight: [{ targetId: 'd1' }, { targetId: 'd2', pulse: true }],
    },
    // 4 — Successful defense clears the table
    {
      id: 'defended',
      titleKey: 'tutorial.durak.defended.title',
      bodyKey: 'tutorial.durak.defended.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'trick',
        trump: 'hearts',
        seats: [OPP, ME],
        chips: [{ id: 'zone.defended', text: 'Defended ✓', tone: 'good' }],
        discardTop: c('disc', 'spades', 'K'),
        hand: [c('h1', 'spades', '6'), c('h2', 'clubs', '7'), c('h3', 'diamonds', '10')],
      },
      highlight: [{ targetId: 'zone.defended', pulse: true }],
    },
    // 5 — Failed defense → take the cards
    {
      id: 'take',
      titleKey: 'tutorial.durak.take.title',
      bodyKey: 'tutorial.durak.take.body',
      estimatedSeconds: 18,
      scene: {
        layout: 'trick',
        trump: 'hearts',
        seats: [{ ...OPP }, { ...ME, roleKey: 'tutorial.role.defender' }],
        chips: [{ id: 'zone.take', text: 'Take ↑', tone: 'bad' }],
        pairs: [{ id: 'p1', attack: c('a1', 'clubs', 'A') }],
        hand: [c('h1', 'spades', '6'), c('h2', 'diamonds', '4')],
      },
      highlight: [{ targetId: 'a1' }, { targetId: 'zone.take', pulse: true }],
    },
    // 6 — Empty your hand / endgame
    {
      id: 'endgame',
      titleKey: 'tutorial.durak.endgame.title',
      bodyKey: 'tutorial.durak.endgame.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        trump: 'hearts',
        seats: [{ ...OPP, handCount: 4, roleKey: undefined }, { ...ME, roleKey: undefined }],
        drawCount: 0,
        chips: [{ id: 'zone.durak', text: '🃏 last = durak', tone: 'bad' }],
        hand: [c('h1', 'hearts', 'A')],
      },
      highlight: [{ targetId: 'zone.durak', pulse: true }],
    },
  ],
};
