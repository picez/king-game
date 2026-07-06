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
import DurakDeck from './DurakDeck';

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

/**
 * Seat positions around the felt by relative index (0 = me at the bottom), so the
 * opponents sit clockwise in PLAY ORDER. Mirrors King's tablePositions (Stage 9.11).
 *  - 2p: me bottom, opponent top
 *  - 3p: me bottom, opponents at the two top corners (left/right)
 *  - 4p: me bottom, opponents left / top / right
 */
const SEAT_LAYOUT: Record<number, string[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
};

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
  const iAmThrower = state.throwerIndex === meSeat;   // the current attacker (acts now)
  const iAmPrimary = state.attackerIndex === meSeat;  // the bout's primary attacker
  const iAmDefender = state.defenderIndex === meSeat;
  const phase = state.status;
  // 'attack' and 'taking' both let the current thrower add/pass cards (in 'taking'
  // the defender no longer beats — attackers just pile on before the take).
  const isThrowPhase = phase === 'attack' || phase === 'taking';

  // Transfer mode is only meaningful on my defending turn.
  useEffect(() => { if (!isMyTurn) setTransferMode(false); }, [isMyTurn]);

  const unbeaten = unbeatenAttacks(state);
  const attackValid = isMyTurn && isThrowPhase && iAmThrower ? getValidAttackCards(state) : [];
  const transferValid = transferMode && canTransfer(state) ? getValidTransferCards(state) : [];
  const defenseValid = isMyTurn && phase === 'defense' && iAmDefender && !transferMode
    ? me.hand.filter((c) => unbeaten.some((a) => beats(c, a, state.trumpSuit)))
    : [];

  const inSet = (set: Card[], c: Card) => set.some((x) => sameCard(x, c));
  const cardEnabled = (c: Card) =>
    transferMode ? inSet(transferValid, c)
      : isThrowPhase ? inSet(attackValid, c)
        : inSet(defenseValid, c);

  function clickCard(c: Card) {
    if (!isMyTurn || !cardEnabled(c)) return;
    if (transferMode) { apply({ type: 'TRANSFER_ATTACK', card: c }); setTransferMode(false); return; }
    if (isThrowPhase && iAmThrower) { apply({ type: 'ATTACK_CARD', card: c }); return; }
    if (phase === 'defense' && iAmDefender) {
      const target = unbeaten.find((a) => beats(c, a, state.trumpSuit));
      if (target) apply({ type: 'DEFEND_CARD', attack: target, card: c });
    }
  }

  const canPass = isMyTurn && isThrowPhase && iAmThrower && state.table.length > 0;
  const canTake = isMyTurn && phase === 'defense' && iAmDefender;
  const canTransferBtn = isMyTurn && phase === 'defense' && iAmDefender && state.variant === 'transfer' && canTransfer(state);

  const trumpRed = state.trumpSuit === 'hearts' || state.trumpSuit === 'diamonds';
  // Opponents laid out in PLAY ORDER — clockwise from the seat after me — so it
  // reads "who comes after whom" (Stage 9.10). Not mirrored for RTL.
  const opponents = Array.from({ length: state.players.length - 1 },
    (_, k) => state.players[(meSeat + 1 + k) % state.players.length]);
  const offline = (seat: number) => (disconnectedSeats ?? []).includes(seat);
  // The current actor: the THROWER while attacking/taking, else the defender.
  const actorSeat = phase === 'defense' ? state.defenderIndex : state.throwerIndex;
  const actor = state.players[actorSeat];
  const iAmActiveAttacker = iAmThrower || iAmPrimary;
  const myRole = iAmDefender ? t('durak.defender') : iAmActiveAttacker ? t('durak.attacker') : '';

  // One clear instruction for the current moment: my move, a bot thinking, an
  // offline human (AI may substitute), or just waiting for another player to act.
  const waitMsg = offline(actorSeat) ? `${actor?.name} ${t('durak.offlineAI')}`
    : actor?.type === 'ai' ? t('durak.botThinking')
      : `${t('durak.waiting')} ${actor?.name}…`;
  const prompt = transferMode ? t('durak.promptTransfer')
    : phase === 'taking' && iAmDefender ? t('durak.youAreTaking')
      : !isMyTurn ? waitMsg
        : phase === 'taking' ? t('durak.promptTakeThrowIn')
          : phase === 'attack'
            ? (state.table.length === 0 ? t('durak.promptAttackLead') : t('durak.promptThrowOrPass'))
            : canTransferBtn ? t('durak.promptDefendTransfer') : t('durak.promptDefend');

  const noticeText = notice?.kind === 'took' ? `${notice.name} ${t('durak.took')}`
    : notice?.kind === 'beaten' ? t('durak.beaten') : null;

  return (
    <div className={`screen durak-screen ${transferMode ? 'durak-screen--transfer' : ''}`}>
      {showHelp && <DurakHelp variant={state.variant} onClose={() => setShowHelp(false)} />}
      <div className="durak-topbar">
        <button type="button" className="btn btn--ghost durak-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className={`durak-trump ${trumpRed ? 'durak-trump--red' : ''}`}>
          {t('durak.trump')} <strong>{SUIT_SYMBOL[state.trumpSuit]}</strong>
        </span>
        <button type="button" className="btn btn--ghost durak-help-btn" onClick={() => setShowHelp(true)} aria-label={t('durak.howToPlay')}>❓</button>
      </div>

      {/* Circular table: opponents seated around the felt in PLAY ORDER (clockwise
          from me at the bottom); the deck + trick pairs sit in the centre. */}
      <div className={`durak-board durak-board--${state.players.length}`}>
        <div className="durak-board__felt" aria-hidden="true" />
        {opponents.map((p, k) => {
          const role = p.seatIndex === state.attackerIndex ? 'atk' : p.seatIndex === state.defenderIndex ? 'def' : '';
          const isOffline = offline(p.seatIndex);
          const isActing = p.seatIndex === actorSeat;
          const isThrowing = isThrowPhase && p.seatIndex === state.throwerIndex && p.seatIndex !== state.attackerIndex;
          const isTaking = phase === 'taking' && p.seatIndex === state.defenderIndex;
          const pos = (SEAT_LAYOUT[state.players.length] ?? SEAT_LAYOUT[4])[k + 1];
          return (
            <div key={p.id} className={`durak-seat durak-seat--${pos} ${role ? `durak-seat--${role}` : ''} ${isOffline ? 'durak-seat--offline' : ''} ${isActing ? 'durak-seat--acting' : ''}`}>
              <span className="durak-seat__name">
                {isOffline && <span className="durak-seat__off" aria-label={t('common.offline')}>📴 </span>}{p.name}
              </span>
              <span className="durak-seat__count">🂠 {p.hand.length}</span>
              {role === 'atk' && <span className="durak-seat__role">{t('durak.attacker')}</span>}
              {role === 'def' && !isTaking && <span className="durak-seat__role">{t('durak.defender')}</span>}
              {isTaking && <span className="durak-seat__role durak-seat__role--take">{t('durak.taking')}</span>}
              {isThrowing && <span className="durak-seat__role">{t('durak.throwing')}</span>}
            </div>
          );
        })}
        <div className="durak-centre">
          {noticeText && <div className="durak-notice" role="status">{noticeText}</div>}
          <DurakDeck count={state.drawPile.length} trumpCard={state.trumpCard} trumpSuit={state.trumpSuit} />
          <div className="durak-table__cards">
            {state.table.length === 0
              ? <p className="durak-table__empty">{isMyTurn && iAmThrower ? t('durak.tableEmpty') : '·'}</p>
              : state.table.map((pair, i) => (
                <div className={`durak-pair ${pair.defense ? 'durak-pair--beaten' : 'durak-pair--unbeaten'}`} key={i}>
                  <CardView card={pair.attack} size="table" disabled highlight={pair.defense === null} />
                  {pair.defense && (
                    <span className="durak-pair__def"><CardView card={pair.defense} size="table" disabled /></span>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className={`durak-prompt ${isMyTurn ? 'durak-prompt--me' : ''}`}>
        {myRole && <span className={`durak-youare durak-youare--${iAmDefender ? 'def' : 'atk'}`}>{t('durak.youAre')} {myRole}</span>}
        <span className="durak-prompt__text">{prompt}</span>
      </div>

      <div className="durak-controls">
        {canPass && <button type="button" className="btn btn--outline" onClick={() => apply({ type: 'PASS_ATTACK' })}>✓ {t('durak.pass')}</button>}
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
