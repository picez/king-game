import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import type { Card } from '../../models/types';
import type { DurakAction, DurakState } from '../../games/durak/types';
import { getActingDurakPlayerId } from '../../games/durak/engine';
import {
  beats, canTransfer, getValidAttackCards, getValidTransferCards, sameCard, unbeatenAttacks,
} from '../../games/durak/rules';

interface Props {
  state: DurakState;
  humanId: string;
  apply: (a: DurakAction) => void;
  onExit: () => void;
}

/** The local human's table view: opponents, trump/deck, table pairs, hand, actions. */
export default function DurakGameScreen({ state, humanId, apply, onExit }: Props) {
  const { t } = useI18n();
  const [transferMode, setTransferMode] = useState(false);

  const me = state.players.find((p) => p.id === humanId)!;
  const meSeat = me.seatIndex;
  const isMyTurn = getActingDurakPlayerId(state) === humanId;
  const iAmAttacker = state.attackerIndex === meSeat;
  const iAmDefender = state.defenderIndex === meSeat;
  const phase = state.status;

  // Transfer mode is only meaningful on my defending turn.
  useEffect(() => { if (!isMyTurn) setTransferMode(false); }, [isMyTurn]);

  const unbeaten = unbeatenAttacks(state);
  const attackValid = isMyTurn && phase === 'attack' && iAmAttacker ? getValidAttackCards(state) : [];
  const transferValid = transferMode && canTransfer(state) ? getValidTransferCards(state) : [];
  const defenseValid = isMyTurn && phase === 'defense' && iAmDefender && !transferMode
    ? me.hand.filter((c) => unbeaten.some((a) => beats(c, a, state.trumpSuit)))
    : [];

  const inSet = (set: Card[], c: Card) => set.some((x) => sameCard(x, c));
  const cardEnabled = (c: Card) =>
    transferMode ? inSet(transferValid, c)
      : phase === 'attack' ? inSet(attackValid, c)
        : inSet(defenseValid, c);

  function clickCard(c: Card) {
    if (!isMyTurn || !cardEnabled(c)) return;
    if (transferMode) { apply({ type: 'TRANSFER_ATTACK', card: c }); setTransferMode(false); return; }
    if (phase === 'attack' && iAmAttacker) { apply({ type: 'ATTACK_CARD', card: c }); return; }
    if (phase === 'defense' && iAmDefender) {
      const target = unbeaten.find((a) => beats(c, a, state.trumpSuit));
      if (target) apply({ type: 'DEFEND_CARD', attack: target, card: c });
    }
  }

  const canPass = isMyTurn && phase === 'attack' && iAmAttacker && state.table.length > 0;
  const canTake = isMyTurn && phase === 'defense' && iAmDefender;
  const canTransferBtn = isMyTurn && phase === 'defense' && iAmDefender && state.variant === 'transfer' && canTransfer(state);

  const trumpRed = state.trumpSuit === 'hearts' || state.trumpSuit === 'diamonds';
  const opponents = state.players.filter((p) => p.id !== humanId);
  const actor = state.players[phase === 'attack' ? state.attackerIndex : state.defenderIndex];
  const myRole = iAmAttacker ? t('durak.attacker') : iAmDefender ? t('durak.defender') : '';

  return (
    <div className="screen durak-screen">
      <div className="durak-topbar">
        <button type="button" className="btn btn--ghost durak-exit" onClick={onExit} aria-label="Back">✕</button>
        <span className={`durak-trump ${trumpRed ? 'durak-trump--red' : ''}`}>
          {t('durak.trump')} <strong>{SUIT_SYMBOL[state.trumpSuit]}</strong>
        </span>
        <span className="durak-deck" aria-label="Deck">🂠 {state.drawPile.length}</span>
      </div>

      <div className="durak-opponents">
        {opponents.map((p) => {
          const role = p.seatIndex === state.attackerIndex ? 'atk' : p.seatIndex === state.defenderIndex ? 'def' : '';
          return (
            <div key={p.id} className={`durak-opp ${role ? `durak-opp--${role}` : ''}`}>
              <span className="durak-opp__name">{p.name}</span>
              <span className="durak-opp__count">🂠 {p.hand.length}</span>
              {role === 'atk' && <span className="durak-opp__role">{t('durak.attacker')}</span>}
              {role === 'def' && <span className="durak-opp__role">{t('durak.defender')}</span>}
            </div>
          );
        })}
      </div>

      <div className="durak-table">
        {state.table.length === 0
          ? <p className="durak-table__empty">{isMyTurn && iAmAttacker ? t('durak.tableEmpty') : ''}</p>
          : state.table.map((pair, i) => (
            <div className="durak-pair" key={i}>
              <CardView card={pair.attack} size="table" disabled />
              {pair.defense && (
                <span className="durak-pair__def"><CardView card={pair.defense} size="table" disabled /></span>
              )}
            </div>
          ))}
      </div>

      <div className="durak-status">
        {isMyTurn
          ? <strong>{phase === 'attack' ? t('durak.yourTurnAttack') : t('durak.yourTurnDefend')}{myRole ? ` (${myRole})` : ''}</strong>
          : <span>{t('durak.waiting')} {actor?.name}…</span>}
        {transferMode && <span className="durak-status__hint"> · {t('durak.transferHint')}</span>}
      </div>

      <div className="durak-controls">
        {canPass && <button type="button" className="btn btn--outline" onClick={() => apply({ type: 'END_ATTACK' })}>{t('durak.pass')}</button>}
        {canTake && <button type="button" className="btn btn--danger" onClick={() => apply({ type: 'TAKE_CARDS' })}>{t('durak.take')}</button>}
        {canTransferBtn && !transferMode && <button type="button" className="btn btn--outline" onClick={() => setTransferMode(true)}>{t('durak.transfer')}</button>}
        {transferMode && <button type="button" className="btn btn--ghost" onClick={() => setTransferMode(false)}>{t('durak.cancel')}</button>}
      </div>

      <div className="durak-hand">
        {me.hand.map((c, i) => (
          <CardView
            key={`${c.rank}${c.suit}${i}`}
            card={c}
            size="hand"
            onClick={() => clickCard(c)}
            disabled={!cardEnabled(c)}
            dimmed={isMyTurn && !cardEnabled(c)}
          />
        ))}
      </div>
    </div>
  );
}
