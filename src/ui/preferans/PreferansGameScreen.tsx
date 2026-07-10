import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import type { Card, Suit } from '../../models/types';
import type { Bid, ContractSuit, PreferansAction, PreferansState, PreferansTrick } from '../../games/preferans/types';
import {
  canDiscard,
  cardEquals,
  CONTRACT_SUIT_ORDER,
  getActingPreferansSeat,
  getValidPlayableCards,
  trumpSuitOf,
} from '../../games/preferans/rules';
import { validBids, validDeclareContracts, bidKey } from './bids';
import PreferansHelp from './PreferansHelp';

interface Props {
  state: PreferansState;
  /** The human's seat (always 0 in the local game). */
  humanSeat: number;
  apply: (a: PreferansAction) => void;
  onExit: () => void;
  /** A just-resolved trick shown briefly in the centre (blocks input while set). */
  reviewTrick: PreferansTrick | null;
}

/** Seat slots around the felt by RELATIVE offset from the viewer (bottom). Preferans
 *  plays to the LEFT (0→1→2); with the viewer at the bottom that reads bottom → left
 *  → right, so play flows counter-clockwise and is NOT RTL-mirrored (RULES §2, §8). */
const POSITIONS = ['bottom', 'left', 'right'] as const;
type SeatPos = (typeof POSITIONS)[number];
function seatPosition(seat: number, viewerSeat: number): SeatPos {
  return POSITIONS[(seat - viewerSeat + 3) % 3];
}

const SUIT_ORDER: Record<Suit, number> = { spades: 0, clubs: 1, diamonds: 2, hearts: 3 };
const isRed = (s: Suit) => s === 'hearts' || s === 'diamonds';

/** Symbol for a contract suit, incl. No-Trump. */
function contractSuitSymbol(suit: ContractSuit): string {
  return suit === 'NT' ? 'NT' : SUIT_SYMBOL[suit];
}
/** e.g. "8♥" or "7 NT". */
function contractLabel(bid: Bid): string {
  return bid.suit === 'NT' ? `${bid.level} NT` : `${bid.level}${SUIT_SYMBOL[bid.suit]}`;
}

/** Group by suit (auction order); the trump suit (once known) sits last for clarity. */
function sortHand(cards: Card[], trump: Suit | null): Card[] {
  return cards.slice().sort((a, b) => {
    const at = trump && a.suit === trump ? 1 : 0;
    const bt = trump && b.suit === trump ? 1 : 0;
    if (at !== bt) return at - bt;
    if (a.suit !== b.suit) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    return a.value - b.value;
  });
}

/** The local human's table view for one Preferans hand. */
export default function PreferansGameScreen({ state, humanSeat, apply, onExit, reviewTrick }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);
  // Cards the human has picked to bury (talon discard step); reset whenever the
  // phase or the acting seat changes so a stale selection never carries over.
  const [selectedDiscards, setSelectedDiscards] = useState<Card[]>([]);

  const phase = state.phase;
  const actingSeat = getActingPreferansSeat(state);
  const blocked = reviewTrick != null || phase === 'hand_complete';
  const isMyTurn = actingSeat === humanSeat && !blocked;
  const iAmDeclarer = state.declarerSeat === humanSeat;

  // Talon sub-step for the declarer.
  const talonTakePending = phase === 'talon' && state.talon.length > 0;
  const talonDiscardPending = phase === 'talon' && state.talon.length === 0 && state.discards.length === 0;
  const talonDeclarePending = phase === 'talon' && state.discards.length > 0 && state.contract === null;

  useEffect(() => {
    setSelectedDiscards([]);
  }, [phase, actingSeat]);

  const trumpSuit = state.contract ? trumpSuitOf(state.contract) : null;
  const legalCards = phase === 'playing' && isMyTurn ? getValidPlayableCards(state, humanSeat) : [];
  const cardPlayable = (c: Card) => legalCards.some((x) => cardEquals(x, c));

  const discardMode = isMyTurn && iAmDeclarer && talonDiscardPending;
  const discardSelected = (c: Card) => selectedDiscards.some((x) => cardEquals(x, c));
  const canConfirmDiscard =
    selectedDiscards.length === 2 && canDiscard(state, humanSeat, selectedDiscards as [Card, Card]);

  function toggleDiscard(c: Card) {
    setSelectedDiscards((sel) => {
      if (sel.some((x) => cardEquals(x, c))) return sel.filter((x) => !cardEquals(x, c));
      if (sel.length >= 2) return sel; // exactly two — ignore extra picks
      return [...sel, c];
    });
  }

  function clickCard(c: Card) {
    if (discardMode) { toggleDiscard(c); return; }
    if (isMyTurn && phase === 'playing' && cardPlayable(c)) apply({ type: 'PLAY_CARD', card: c });
  }

  const trick = reviewTrick ?? state.currentTrick;

  // The current bid ladder / declare options (only legal shapes are actionable).
  const legalBidKeys = new Set(
    (phase === 'bidding' && isMyTurn ? validBids(state, humanSeat) : []).map(bidKey),
  );
  const legalDeclareKeys = new Set(
    (talonDeclarePending && isMyTurn ? validDeclareContracts(state, humanSeat) : []).map(bidKey),
  );

  // One clear instruction for the current moment.
  const actor = actingSeat != null ? state.players[actingSeat] : null;
  const waitFor = (botKey: string) =>
    actor?.type === 'ai' ? t(botKey)
      : actor ? `${t('preferans.waiting')} ${actor.name}…` : '';
  let prompt = '';
  if (blocked) prompt = '';
  else if (phase === 'bidding') prompt = isMyTurn ? t('preferans.yourBid') : waitFor('preferans.botBidding');
  else if (phase === 'talon') {
    if (isMyTurn && iAmDeclarer) {
      prompt = talonTakePending ? t('preferans.youTakeTalon')
        : talonDiscardPending ? t('preferans.youDiscard')
          : t('preferans.youDeclare');
    } else prompt = waitFor('preferans.botTalon');
  } else if (phase === 'playing') prompt = isMyTurn ? t('preferans.yourPlay') : waitFor('preferans.botThinking');

  const highBidderName = state.highBid
    ? state.highBid.seat === humanSeat ? t('preferans.you') : state.players[state.highBid.seat].name
    : null;
  const declarerName = state.declarerSeat != null
    ? state.declarerSeat === humanSeat ? t('preferans.you') : state.players[state.declarerSeat].name
    : null;
  const iPassed = phase === 'bidding' && state.passed[humanSeat] && !isMyTurn;
  const ledSuit = state.currentTrick?.ledSuit ?? null;
  const trumpIsRed = trumpSuit != null && isRed(trumpSuit);

  return (
    <div className="screen preferans-screen">
      {showHelp && <PreferansHelp onClose={() => setShowHelp(false)} />}

      <div className="preferans-topbar">
        <button type="button" className="btn btn--ghost preferans-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className="preferans-phase">{t(`preferans.phase.${phaseKey(phase)}`)}</span>
        <button type="button" className="btn btn--ghost preferans-help-btn" onClick={() => setShowHelp(true)} aria-label={t('preferans.howToPlay')}>❓</button>
      </div>

      {/* Scoreboard: three per-seat scores + target, contract, high bid. */}
      <div className="preferans-scoreboard">
        <div className="preferans-scores">
          {state.players.map((p) => (
            <div key={p.id} className={`preferans-score ${p.seatIndex === humanSeat ? 'preferans-score--me' : ''}`}>
              <span className="preferans-score__label">
                {p.seatIndex === humanSeat ? t('preferans.you') : p.name}
              </span>
              <span className="preferans-score__value">{state.scores[p.seatIndex]}</span>
            </div>
          ))}
        </div>
        <div className="preferans-scoreboard__mid">
          <span className="preferans-target">🎯 {state.targetScore}</span>
          {state.contract ? (
            <span className={`preferans-contract ${trumpIsRed ? 'preferans-contract--red' : ''}`}>
              {t('preferans.contract')} <strong>{contractLabel(state.contract)}</strong>
              {declarerName && <span className="preferans-contract__by"> · {declarerName}</span>}
            </span>
          ) : (
            <span className="preferans-bid">
              {t('preferans.highestBid')}:{' '}
              <strong>{state.highBid ? contractLabel(state.highBid) : t('preferans.noBid')}</strong>
              {highBidderName && <span className="preferans-bid__by"> · {highBidderName}</span>}
            </span>
          )}
          {phase === 'playing' && ledSuit && (
            <span className={`preferans-led ${isRed(ledSuit) ? 'preferans-led--red' : ''}`}>
              {t('preferans.led')} <strong>{SUIT_SYMBOL[ledSuit]}</strong>
            </span>
          )}
          {phase === 'talon' && (
            <span className="preferans-talon">
              🂠 {t('preferans.talon')}: <strong>{talonTakePending ? state.talon.length : t('preferans.taken')}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Round table: three seats around the felt in play order, trick in the centre. */}
      <div className="preferans-board">
        <div className="preferans-board__felt" aria-hidden="true" />
        {state.players.map((p) => {
          const pos = seatPosition(p.seatIndex, humanSeat);
          const isActing = p.seatIndex === actingSeat && !blocked;
          const isDealer = p.seatIndex === state.dealerSeat;
          const isDeclarer = p.seatIndex === state.declarerSeat;
          const bidLabel = phase === 'bidding'
            ? (state.passed[p.seatIndex]
              ? t('preferans.passed')
              : state.highBid?.seat === p.seatIndex ? contractLabel(state.highBid) : '')
            : '';
          return (
            <div
              key={p.id}
              className={`preferans-seat preferans-seat--${pos} ${isActing ? 'preferans-seat--acting' : ''} ${isDeclarer ? 'preferans-seat--declarer' : ''}`}
            >
              <span className="preferans-seat__badges">
                {isDealer && <span className="preferans-badge preferans-badge--dealer" title={t('preferans.dealer')}>D</span>}
                {isDeclarer && <span className="preferans-badge preferans-badge--declarer" title={t('preferans.declarer')}>★</span>}
              </span>
              <span className="preferans-seat__name">
                {p.seatIndex === humanSeat ? t('preferans.you') : p.name}
              </span>
              <span className="preferans-seat__meta">
                {(phase === 'playing' || phase === 'hand_complete')
                  ? <span className="preferans-seat__tricks">✋ {state.tricksBySeat[p.seatIndex]}</span>
                  : p.seatIndex !== humanSeat
                    ? <span className="preferans-seat__count">🂠 {state.handsBySeat[p.seatIndex].length}</span>
                    : null}
              </span>
              {bidLabel && <span className="preferans-seat__bid">{bidLabel}</span>}
            </div>
          );
        })}

        <div className="preferans-centre">
          {trick && trick.plays.length > 0 ? (
            trick.plays.map((play) => {
              const pos = seatPosition(play.seat, humanSeat);
              const winning = reviewTrick != null && reviewTrick.winnerSeat === play.seat;
              return (
                <div key={play.seat} className={`preferans-play preferans-play--${pos}`}>
                  <CardView card={play.card} size="table" disabled highlight={winning} />
                </div>
              );
            })
          ) : (
            <p className="preferans-centre__empty">{phase === 'playing' && isMyTurn ? '·' : ''}</p>
          )}
        </div>
      </div>

      <div className={`preferans-prompt ${isMyTurn ? 'preferans-prompt--me' : ''}`}>
        <span className="preferans-prompt__text">{prompt}</span>
        {iPassed && <span className="preferans-prompt__note">{t('preferans.youPassed')}</span>}
        {discardMode && <span className="preferans-prompt__note">{t('preferans.discardHint')}</span>}
      </div>

      {/* Action area: bidding ladder, talon buttons, discard confirm, or declare ladder. */}
      {phase === 'bidding' && isMyTurn && (
        <div className="preferans-actions preferans-bidbar">
          <BidLadder legalKeys={legalBidKeys} onPick={(b) => apply({ type: 'BID', level: b.level, suit: b.suit })} />
          <button type="button" className="btn btn--ghost preferans-passbtn" onClick={() => apply({ type: 'PASS_BID' })}>
            {t('preferans.pass')}
          </button>
        </div>
      )}

      {phase === 'talon' && isMyTurn && iAmDeclarer && talonTakePending && (
        <div className="preferans-actions preferans-talonbar">
          <div className="preferans-talon-cards" aria-hidden="true">
            {state.talon.map((_, i) => (
              <CardView key={i} card={{ suit: 'spades', rank: '?', value: 0 } as unknown as Card} size="table" disabled />
            ))}
          </div>
          <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'TAKE_TALON' })}>
            {t('preferans.takeTalon')}
          </button>
        </div>
      )}

      {discardMode && (
        <div className="preferans-actions preferans-discardbar">
          <button type="button" className="btn btn--primary" disabled={!canConfirmDiscard}
            onClick={() => canConfirmDiscard && apply({ type: 'DISCARD', cards: selectedDiscards as [Card, Card] })}>
            {t('preferans.discard')} ({selectedDiscards.length}/2)
          </button>
        </div>
      )}

      {talonDeclarePending && isMyTurn && iAmDeclarer && (
        <div className="preferans-actions preferans-declarebar">
          <span className="preferans-declarebar__label">{t('preferans.declareLabel')}</span>
          <BidLadder legalKeys={legalDeclareKeys} onPick={(b) => apply({ type: 'DECLARE_CONTRACT', level: b.level, suit: b.suit })} />
        </div>
      )}

      {/* The human's hand. During the discard step cards toggle a selection; while
          playing they play; otherwise they are inert. */}
      <div className="preferans-hand">
        {sortHand(state.handsBySeat[humanSeat], trumpSuit).map((c) => (
          <CardView
            key={`${c.rank}${c.suit}`}
            card={c}
            size="hand"
            onClick={() => clickCard(c)}
            selected={discardMode && discardSelected(c)}
            disabled={!discardMode && (phase !== 'playing' || !cardPlayable(c))}
            dimmed={phase === 'playing' && isMyTurn && !cardPlayable(c)}
          />
        ))}
      </div>

      {phase === 'hand_complete' && state.lastHand && (
        <HandComplete state={state} humanSeat={humanSeat} onNext={() => apply({ type: 'START_NEXT_HAND' })} />
      )}
    </div>
  );
}

/** Compact 5×5 bid ladder (levels 6–10 × ♠♣♦♥NT). Only legal cells are actionable. */
function BidLadder({ legalKeys, onPick }: { legalKeys: Set<string>; onPick: (b: Bid) => void }) {
  const levels = [6, 7, 8, 9, 10];
  return (
    <div className="preferans-ladder" role="group">
      {levels.map((level) => (
        <div key={level} className="preferans-ladder__row">
          <span className="preferans-ladder__lvl">{level}</span>
          {CONTRACT_SUIT_ORDER.map((suit) => {
            const bid: Bid = { level, suit };
            const legal = legalKeys.has(bidKey(bid));
            const red = suit === 'hearts' || suit === 'diamonds';
            return (
              <button
                key={suit}
                type="button"
                className={`preferans-ladder__cell ${red ? 'preferans-ladder__cell--red' : ''}`}
                disabled={!legal}
                onClick={() => legal && onPick(bid)}
                aria-label={`${level} ${suit === 'NT' ? 'NT' : suit}`}
              >
                {contractSuitSymbol(suit)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function phaseKey(phase: PreferansState['phase']): string {
  switch (phase) {
    case 'bidding': return 'bidding';
    case 'talon': return 'talon';
    case 'playing': return 'playing';
    case 'hand_complete': return 'handComplete';
    default: return 'finished';
  }
}

/** The between-hands result panel (contract / tricks / per-seat score delta). */
function HandComplete({ state, humanSeat, onNext }: {
  state: PreferansState;
  humanSeat: number;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const hand = state.lastHand!;
  const declarerName = hand.declarerSeat === humanSeat ? t('preferans.you') : state.players[hand.declarerSeat].name;
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

  return (
    <div className="preferans-handdone-overlay" role="dialog" aria-modal="true">
      <div className="preferans-handdone">
        <h2 className="preferans-handdone__title">
          {hand.made ? `✅ ${t('preferans.contractMade')}` : `❌ ${t('preferans.contractFailed')}`}
        </h2>
        <p className="preferans-handdone__line">
          <span className="preferans-badge preferans-badge--declarer">★</span> {declarerName} · {t('preferans.contract')}{' '}
          <strong>{contractLabel(hand.contract)}</strong> · {t('preferans.tricks')} <strong>{hand.declarerTricks}/{hand.contract.level}</strong>
        </p>
        <table className="preferans-handdone__table">
          <thead>
            <tr><th></th><th>{t('preferans.tricks')}</th><th>{t('preferans.hand')}</th><th>{t('preferans.score')}</th></tr>
          </thead>
          <tbody>
            {state.players.map((p) => (
              <tr key={p.id}>
                <td>{p.seatIndex === humanSeat ? t('preferans.you') : p.name}</td>
                <td>{state.tricksBySeat[p.seatIndex]}</td>
                <td>{fmt(hand.deltaBySeat[p.seatIndex])}</td>
                <td><strong>{state.scores[p.seatIndex]}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn--primary preferans-handdone__next" onClick={onNext} autoFocus>
          {t('preferans.nextHand')}
        </button>
      </div>
    </div>
  );
}
