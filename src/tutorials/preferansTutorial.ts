// ---------------------------------------------------------------------------
// Preferans scripted tutorial (Stage 31.2). 6 steps, ≤120 s — a LIGHT MVP intro
// (TUTORIALS_PLAN.md §3.5). Teaches only product-supported behaviour: contract,
// declarer vs two defenders, the talon, 10 tricks, contract scoring. It does NOT
// present classic variants (misère, four-player) as playable — the last step notes
// they are not in the app yet. Pure; no engine imports.
// ---------------------------------------------------------------------------

import type { Tutorial, TutorialCardFace, TutorialSeat, TutorialTrickCard } from './types';

const c = (id: string, suit: TutorialCardFace['suit'], rank: TutorialCardFace['rank']): TutorialCardFace =>
  ({ id, suit, rank });
const tc = (id: string, card: TutorialCardFace, extra: Partial<TutorialTrickCard> = {}): TutorialTrickCard =>
  ({ id, card, ...extra });

const YOU: TutorialSeat = { id: 's.me', pos: 'bottom', nameKey: 'tutorial.seat.you', roleKey: 'tutorial.role.declarer', isMe: true };
const DEF_L: TutorialSeat = { id: 's.dl', pos: 'left', nameKey: 'tutorial.seat.rival', roleKey: 'tutorial.role.defender' };
const DEF_R: TutorialSeat = { id: 's.dr', pos: 'right', nameKey: 'tutorial.seat.rival', roleKey: 'tutorial.role.defender' };

export const preferansTutorial: Tutorial = {
  id: 'preferans',
  enabled: true,
  learnKey: 'tutorial.preferans.learn',
  steps: [
    {
      id: 'goal',
      titleKey: 'tutorial.preferans.goal.title',
      bodyKey: 'tutorial.preferans.goal.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.target', text: 'target 10' }],
        hand: [c('h1', 'spades', 'A'), c('h2', 'spades', 'K'), c('h3', 'hearts', 'A'), c('h4', 'diamonds', '10'), c('h5', 'clubs', 'K')],
      },
      highlight: [{ targetId: 'zone.target', pulse: true }],
    },
    {
      id: 'roles',
      titleKey: 'tutorial.preferans.roles.title',
      bodyKey: 'tutorial.preferans.roles.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'hand-only',
        seats: [YOU, DEF_L, DEF_R],
        chips: [{ id: 'zone.contract', text: '6–10 × ♠♣♦♥ / NT' }],
      },
      highlight: [{ targetId: 's.me', pulse: true }, { targetId: 'zone.contract' }],
    },
    {
      id: 'talon',
      titleKey: 'tutorial.preferans.talon.title',
      bodyKey: 'tutorial.preferans.talon.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [{ id: 'zone.talon', text: 'talon +2 · bury 2', tone: 'gold' }],
        hand: [c('h1', 'spades', 'A'), c('h2', 'spades', 'K'), c('h3', 'hearts', 'A'), c('h4', 'diamonds', '10')],
      },
      highlight: [{ targetId: 'zone.talon', pulse: true }],
    },
    {
      id: 'follow',
      titleKey: 'tutorial.preferans.follow.title',
      bodyKey: 'tutorial.preferans.follow.body',
      estimatedSeconds: 17,
      scene: {
        layout: 'trick',
        seats: [{ ...DEF_L, roleKey: undefined }, { ...YOU, roleKey: undefined }],
        trick: [tc('t.lead', c('tl', 'diamonds', 'K'), { lead: true }), tc('t.win', c('tw', 'diamonds', 'A'), { winner: true })],
        hand: [c('h.ad', 'diamonds', 'A'), c('h.7d', 'diamonds', '7'), c('h.ks', 'spades', 'K')],
      },
      highlight: [{ targetId: 'tl', pulse: true }, { targetId: 'h.ad' }, { targetId: 'h.7d' }],
    },
    {
      id: 'leads',
      titleKey: 'tutorial.preferans.leads.title',
      bodyKey: 'tutorial.preferans.leads.body',
      estimatedSeconds: 15,
      scene: {
        layout: 'trick',
        chips: [{ id: 'zone.leads', text: 'winner leads next →' }],
        trick: [tc('t.win', c('tw', 'diamonds', 'A'), { winner: true })],
      },
      highlight: [{ targetId: 'tw', pulse: true }, { targetId: 'zone.leads' }],
    },
    {
      id: 'scoring',
      titleKey: 'tutorial.preferans.scoring.title',
      bodyKey: 'tutorial.preferans.scoring.body',
      estimatedSeconds: 16,
      scene: {
        layout: 'hand-only',
        chips: [
          { id: 'zone.make', text: 'make level → score', tone: 'good' },
          { id: 'zone.miss', text: 'miss → defenders score', tone: 'bad' },
        ],
      },
      highlight: [{ targetId: 'zone.make' }, { targetId: 'zone.miss' }],
    },
  ],
};
