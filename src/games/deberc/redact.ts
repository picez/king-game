// ---------------------------------------------------------------------------
// Deberc redaction (Stage 4). Pure: returns the state a viewer may see.
//   • the viewer's own hand is real; every opponent hand is replaced with
//     face-down placeholders (count kept);
//   • `dealtHands` (the snapshot of EVERY seat's full 9-card hand, used for meld
//     scoring) reveals unplayed cards, so other seats' snapshots are hidden until
//     the hand is over (hand_scoring / finished), when they are shown for the
//     meld/score display — mirrors King revealing collected cards at round end;
//   • `stock` = undealt cards nobody is allowed to see → always hidden;
//   • the face-up trump card, trump suit, the current trick on the table, won
//     tricks (already played face-up), melds, scores and ledger are PUBLIC.
// Never leaks a private hand. Mirrors Durak's `durakRedactStateFor`.
// See the deberc-card-accounting note: hide hand + dealtHands + stock.
// ---------------------------------------------------------------------------

import type { Card } from '../../models/types';
import type { DebercState } from './types';

/** The same face-down placeholder King/Durak use, so the client renders a back. */
const HIDDEN = { suit: 'spades', rank: '?', value: 0 } as unknown as Card;

const hide = (cards: Card[]): Card[] => cards.map(() => ({ ...HIDDEN }));

export function debercRedactStateFor(state: DebercState, viewerSeat: number | null): DebercState {
  // Once the hand is scored, all dealt hands are revealed for the meld display.
  const handOver = state.phase === 'hand_scoring' || state.phase === 'finished';
  return {
    ...state,
    players: state.players.map((p) =>
      p.seatIndex === viewerSeat ? { ...p } : { ...p, hand: hide(p.hand) }),
    dealtHands: state.dealtHands.map((h, seat) =>
      handOver || seat === viewerSeat ? h : hide(h)),
    // Undealt cards (9 for 3p, 0 for 4p) — never revealed to anyone.
    stock: hide(state.stock),
    // Прикуп packets are face-down until taken — hidden for EVERY seat (even the
    // owner has not looked). Empty once merged into hands on trump commit.
    prykup: state.prykup.map(hide),
    // Declared melds (v1.3): the ANNOUNCEMENT (seat + kind + nominal) is public,
    // but the actual CARDS are shown only for the viewer's own melds, the §4
    // winners (revealed), or once the hand is over. Others' cards are stripped —
    // so opponents see "Bot 2: Терц до K" but not the cards until it's revealed.
    declaredMelds: state.declaredMelds.map((m) =>
      m.revealed || m.seatIndex === viewerSeat || handOver ? m : { ...m, cards: [] }),
    // tableTrumpCard / trumpSuit / currentTrick / wonCards / melds / scores: public.
  };
}
