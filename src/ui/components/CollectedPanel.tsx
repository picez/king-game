import { useState } from 'react';
import { useGame } from '../../hooks/useGame';
import { useI18n } from '../../i18n';
import { SUIT_SYMBOL } from './CardView';
import { sortHand } from '../../core/rules';
import { wonTrickGroups } from '../../core/tricks';
import type { Card } from '../../models/types';

interface Props {
  /** The viewing player's id — only THEIR own cards are ever shown here. */
  playerId: string | null;
}

function isRed(suit: Card['suit']) {
  return suit === 'hearts' || suit === 'diamonds';
}

function MiniCards({ cards, emptyLabel }: { cards: Card[]; emptyLabel: string }) {
  if (cards.length === 0) return <span className="mini-card--none">{emptyLabel}</span>;
  return (
    <div className="mini-cards">
      {sortHand(cards).map((c, i) => (
        <span key={i} className={`mini-card ${isRed(c.suit) ? 'mini-card--red' : 'mini-card--black'}`}>
          {c.rank}{SUIT_SYMBOL[c.suit]}
        </span>
      ))}
    </div>
  );
}

/**
 * Lets a player privately review their OWN won tricks this round — grouped by
 * trick, cards in play order, with the leader noted and the winning (own) card
 * marked — and (if they are the dealer) their own discard.
 *
 * It reads only the viewer's own data: the won tricks come from the public
 * completed-trick history filtered to this player's wins (see wonTrickGroups),
 * and the discard is dealer-only in the sanitized state. Nothing private to
 * another player is ever shown.
 */
export default function CollectedPanel({ playerId }: Props) {
  const { state } = useGame();
  const { t } = useI18n();
  const [open, setOpen] = useState<null | 'tricks' | 'discard'>(null);
  if (!state || !playerId) return null;

  const round = state.currentRound;
  const groups = wonTrickGroups(round, playerId);
  const isDealer = playerId === round.dealerId;
  const discard = round.discard ?? [];
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="collected-panel">
      <div className="button-row">
        <button className="btn btn--ghost btn--small"
          onClick={() => setOpen((o) => (o === 'tricks' ? null : 'tricks'))}>
          {open === 'tricks' ? t('panel.hideTricks') : `${t('panel.myTricks')} (${groups.length})`}
        </button>
        {isDealer && discard.length > 0 && (
          <button className="btn btn--ghost btn--small"
            onClick={() => setOpen((o) => (o === 'discard' ? null : 'discard'))}>
            {open === 'discard' ? t('panel.hideDiscard') : t('panel.myDiscard')}
          </button>
        )}
      </div>

      {open === 'tricks' && (
        <div className="collected-panel__body">
          {groups.length === 0 ? (
            <span className="mini-card--none">{t('panel.noneYet')}</span>
          ) : (
            <ol className="trick-groups">
              {groups.map((tr) => (
                <li key={tr.trickNumber} className="trick-group">
                  <div className="trick-group__head">
                    <span className="trick-group__num">{t('trick.label')} {tr.trickNumber}</span>
                    <span className="trick-group__lead">▸ {nameOf(tr.leadPlayerId)}</span>
                  </div>
                  <div className="mini-cards">
                    {tr.plays.map((pl, i) => (
                      <span key={i}
                        title={nameOf(pl.playerId)}
                        className={
                          `mini-card ${isRed(pl.card.suit) ? 'mini-card--red' : 'mini-card--black'}` +
                          (pl.playerId === playerId ? ' mini-card--win' : '')
                        }>
                        {pl.card.rank}{SUIT_SYMBOL[pl.card.suit]}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {open === 'discard' && (
        <div className="collected-panel__body"><MiniCards cards={discard} emptyLabel={t('panel.noneYet')} /></div>
      )}
    </div>
  );
}
