// ---------------------------------------------------------------------------
// Poker showdown review (Stage 37.7 §16 G). Shows the AUTHORITATIVE result of the
// finished hand: winner(s), the localized combination name, and the EXACT five
// winning cards (from the evaluator, never recomputed here) highlighted while the
// rest are dimmed. Side pots render as separate rows; tapping a row highlights that
// pot's winning five. A fold-win shows "won uncontested" with no reveal / no
// combination. The ~7s pacing + auto-advance are SERVER-driven online (this only
// displays); local play gets a Next button. Reveals only server-revealed hands.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import type { HandCategory, PokerCard, PokerState } from '../../games/poker/types';
import PokerCardView from './PokerCardView';

const CATEGORY_KEY: Record<HandCategory, string> = {
  high_card: 'poker.cat.highCard', one_pair: 'poker.cat.onePair', two_pair: 'poker.cat.twoPair',
  three_of_a_kind: 'poker.cat.trips', straight: 'poker.cat.straight', flush: 'poker.cat.flush',
  full_house: 'poker.cat.fullHouse', four_of_a_kind: 'poker.cat.quads',
  straight_flush: 'poker.cat.straightFlush', royal_flush: 'poker.cat.royalFlush',
};

export default function PokerShowdownReview({ state, mySeat, onNext }: { state: PokerState; mySeat?: number | null; onNext?: () => void }) {
  const { t } = useI18n();
  const hand = state.lastHand;
  // Only real pot layers (a returned uncalled bet is not a contest); side pots first→last.
  const pots = useMemo(() => (hand?.pots ?? []).filter((p) => !p.returned && p.winners.length > 0), [hand]);
  const [selected, setSelected] = useState(0);

  // id → card lookup from the board + every revealed seat's hole cards (for highlighting).
  const cardById = useMemo(() => {
    const map = new Map<string, PokerCard>();
    for (const c of state.board) map.set(c.id, c);
    for (const seat of hand?.revealedSeats ?? []) for (const c of state.holeCardsBySeat[seat] ?? []) map.set(c.id, c);
    return map;
  }, [state, hand]);

  if (!hand) return null;
  const name = (seat: number) => (seat === mySeat ? t('poker.you') : state.players[seat]?.name ?? `#${seat + 1}`);

  // Fold-win: no reveal, no combination — a short "won uncontested" note.
  if (!hand.showdown) {
    const winner = pots[0]?.winners[0] ?? hand.wonBySeat.findIndex((v) => v > 0);
    return (
      <div className="poker-review poker-review--fold" role="status">
        <p className="poker-review__headline">🏆 {name(winner)} · {t('poker.wonByFold')}</p>
        {onNext && <button type="button" className="btn btn--primary" onClick={onNext}>{t('poker.nextHand')}</button>}
      </div>
    );
  }

  const activePot = pots[selected] ?? pots[0];
  const highlight = new Set<string>();
  for (const seat of activePot?.winners ?? []) for (const id of hand.winningFiveBySeat[seat] ?? []) highlight.add(id);

  return (
    <div className="poker-review" role="status">
      <p className="poker-review__headline">🏆 {t('poker.showdown')}</p>

      {/* Pot rows (main + side). Tap to highlight that pot's winning five. */}
      <ul className="poker-review__pots">
        {pots.map((pot, i) => (
          <li key={i}>
            <button
              type="button"
              className={`poker-review__pot ${i === selected ? 'is-selected' : ''}`}
              onClick={() => setSelected(i)}
            >
              <span className="poker-review__pot-label">
                {pots.length > 1 ? (i === 0 ? t('poker.mainPot') : `${t('poker.sidePot')} ${i}`) : t('poker.pot')}
              </span>
              <span className="poker-review__pot-amount">🪙 {pot.amount}</span>
              <span className="poker-review__pot-winners">
                {pot.winners.map((s) => name(s)).join(', ')}
                {pot.winners.length > 1 ? ` · ${t('poker.split')}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* The selected pot's winning seats: combination + the exact five highlighted. */}
      <div className="poker-review__winners">
        {(activePot?.winners ?? []).map((seat) => (
          <div key={seat} className="poker-review__winner">
            <span className="poker-review__winner-name">{name(seat)}</span>
            <span className="poker-review__winner-cat">{t(CATEGORY_KEY[hand.categoryBySeat[seat]])}</span>
            <div className="poker-review__five">
              {(hand.winningFiveBySeat[seat] ?? []).map((id) => {
                const c = cardById.get(id);
                return c ? <PokerCardView key={id} card={c} size="sm" highlight /> : null;
              })}
            </div>
          </div>
        ))}
      </div>

      {onNext && <button type="button" className="btn btn--primary poker-review__next" onClick={onNext}>{t('poker.nextHand')}</button>}
      {/* Non-winning revealed hands, dimmed. */}
      <div className="poker-review__losers">
        {(hand.revealedSeats ?? []).filter((s) => !(activePot?.winners ?? []).includes(s)).map((seat) => (
          <span key={seat} className="poker-review__loser">
            {name(seat)}: {t(CATEGORY_KEY[hand.categoryBySeat[seat]])}
          </span>
        ))}
      </div>
    </div>
  );
}
