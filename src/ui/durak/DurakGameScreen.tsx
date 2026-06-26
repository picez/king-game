import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import type { Card, Suit } from '../../models/types';
import type { DurakAction, DurakState } from '../../games/durak/types';
import { getActingDurakPlayerId } from '../../games/durak/engine';
import {
  beats, canTransfer, getValidAttackCards, getValidTransferCards, sameCard, unbeatenAttacks,
} from '../../games/durak/rules';
import DurakHelp from './DurakHelp';

/** Transient "what just happened" banner (a bout resolved). */
export type DurakNotice = { kind: 'took'; name: string } | { kind: 'beaten' };

interface Props {
  state: DurakState;
  humanId: string;
  apply: (a: DurakAction) => void;
  onExit: () => void;
  notice?: DurakNotice | null;
  /** Seats whose human is currently offline (online play) — for offline badges. */
  disconnectedSeats?: number[];
}

const SUIT_ORDER: Record<Suit, number> = { spades: 0, clubs: 1, diamonds: 2, hearts: 3 };

/** Display sort: group by suit, low→high, trumps last (so they read clearly). */
function sortHand(cards: Card[], trump: Suit): Card[] {
  return cards.slice().sort((a, b) => {
    const at = a.suit === trump ? 1 : 0;
    const bt = b.suit === trump ? 1 : 0;
    if (at !== bt) return at - bt;
    if (a.suit !== b.suit) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    return a.value - b.value;
  });
}

/** The local human's table view: opponents, trump/deck, table pairs, hand, actions. */
export default function DurakGameScreen({ state, humanId, apply, onExit, notice, disconnectedSeats }: Props) {
  const { t } = useI18n();
  const [transferMode, setTransferMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
  const offline = (seat: number) => (disconnectedSeats ?? []).includes(seat);
  const actorSeat = phase === 'attack' ? state.attackerIndex : state.defenderIndex;
  const actor = state.players[actorSeat];
  const myRole = iAmAttacker ? t('durak.attacker') : iAmDefender ? t('durak.defender') : '';

  // One clear instruction for the current moment: my move, a bot thinking, an
  // offline human (AI may substitute), or just waiting for another human.
  const waitMsg = offline(actorSeat) ? `${actor?.name} ${t('durak.offlineAI')}`
    : actor?.type === 'ai' ? t('durak.botThinking')
      : `${t('durak.waiting')} ${actor?.name}…`;
  const prompt = transferMode ? t('durak.promptTransfer')
    : !isMyTurn ? waitMsg
      : phase === 'attack'
        ? (state.table.length === 0 ? t('durak.promptAttackLead') : t('durak.promptAllBeaten'))
        : canTransferBtn ? t('durak.promptDefendTransfer') : t('durak.promptDefend');

  const noticeText = notice?.kind === 'took' ? `${notice.name} ${t('durak.took')}`
    : notice?.kind === 'beaten' ? t('durak.beaten') : null;

  return (
    <div className={`screen durak-screen ${transferMode ? 'durak-screen--transfer' : ''}`}>
      {showHelp && <DurakHelp variant={state.variant} onClose={() => setShowHelp(false)} />}
      <div className="durak-topbar">
        <button type="button" className="btn btn--ghost durak-exit" onClick={onExit} aria-label="Back">✕</button>
        <span className={`durak-trump ${trumpRed ? 'durak-trump--red' : ''}`}>
          {t('durak.trump')} <strong>{SUIT_SYMBOL[state.trumpSuit]}</strong>
        </span>
        <span className="durak-topbar__right">
          <span className="durak-deck" aria-label="Deck">🂠 {state.drawPile.length}</span>
          <button type="button" className="btn btn--ghost durak-help-btn" onClick={() => setShowHelp(true)} aria-label={t('durak.howToPlay')}>❓</button>
        </span>
      </div>

      <div className="durak-opponents">
        {opponents.map((p) => {
          const role = p.seatIndex === state.attackerIndex ? 'atk' : p.seatIndex === state.defenderIndex ? 'def' : '';
          const isOffline = offline(p.seatIndex);
          return (
            <div key={p.id} className={`durak-opp ${role ? `durak-opp--${role}` : ''} ${isOffline ? 'durak-opp--offline' : ''}`}>
              {isOffline && <span className="durak-opp__off" aria-label="offline">📴</span>}
              <span className="durak-opp__name">{p.name}</span>
              <span className="durak-opp__count">🂠 {p.hand.length}</span>
              {role === 'atk' && <span className="durak-opp__role">{t('durak.attacker')}</span>}
              {role === 'def' && <span className="durak-opp__role">{t('durak.defender')}</span>}
            </div>
          );
        })}
      </div>

      <div className="durak-table">
        {noticeText && <div className="durak-notice" role="status">{noticeText}</div>}
        {state.table.length === 0 && !noticeText
          ? <p className="durak-table__empty">{isMyTurn && iAmAttacker ? t('durak.tableEmpty') : ''}</p>
          : state.table.map((pair, i) => (
            <div className={`durak-pair ${pair.defense ? 'durak-pair--beaten' : 'durak-pair--unbeaten'}`} key={i}>
              <CardView card={pair.attack} size="table" disabled highlight={pair.defense === null} />
              {pair.defense && (
                <span className="durak-pair__def"><CardView card={pair.defense} size="table" disabled /></span>
              )}
            </div>
          ))}
      </div>

      <div className={`durak-prompt ${isMyTurn ? 'durak-prompt--me' : ''}`}>
        {myRole && <span className={`durak-youare durak-youare--${iAmAttacker ? 'atk' : 'def'}`}>{t('durak.youAre')} {myRole}</span>}
        <span className="durak-prompt__text">{prompt}</span>
      </div>

      <div className="durak-controls">
        {canPass && <button type="button" className="btn btn--outline" onClick={() => apply({ type: 'END_ATTACK' })}>✓ {t('durak.pass')}</button>}
        {canTake && <button type="button" className="btn btn--danger" onClick={() => apply({ type: 'TAKE_CARDS' })}>✋ {t('durak.take')}</button>}
        {canTransferBtn && !transferMode && <button type="button" className="btn btn--outline" onClick={() => setTransferMode(true)}>↪ {t('durak.transfer')}</button>}
        {transferMode && <button type="button" className="btn btn--ghost" onClick={() => setTransferMode(false)}>✕ {t('durak.cancel')}</button>}
      </div>

      <div className="durak-hand">
        {sortHand(me.hand, state.trumpSuit).map((c, i) => (
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
