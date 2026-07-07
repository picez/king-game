import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import type { Card, Suit } from '../../models/types';
import type { DebercAction, DebercMeldKind, DebercState } from '../../games/deberc/types';
import { currentLegalPlays, getActingDebercPlayerId } from '../../games/deberc/engine';
import { cardEquals } from '../../games/deberc/rules';
import DebercDeck from './DebercDeck';
import DebercHelp from './DebercHelp';

/** The four declarable meld kinds — buttons are ALWAYS shown (bluffing, §4 v1.2). */
const ALL_MELD_KINDS: DebercMeldKind[] = ['terz', 'platina', 'deberc', 'bella'];

/** Transient "what just happened" banner (a trick resolved). */
export type DebercNotice = { kind: 'trick'; winner: string };

interface Props {
  state: DebercState;
  humanId: string;
  apply: (a: DebercAction) => void;
  onExit: () => void;
  notice?: DebercNotice | null;
  /** Seats whose human is offline (online play) — for offline badges. */
  disconnectedSeats?: number[];
  /** Seconds left on the human's meld-declaring turn (local play), or null. */
  declareSecondsLeft?: number | null;
}

const ALL_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUIT_ORDER: Record<Suit, number> = { spades: 0, clubs: 1, diamonds: 2, hearts: 3 };

/** Seat positions around the felt (0 = me at the bottom), opponents clockwise. */
const SEAT_LAYOUT: Record<number, string[]> = {
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
};

/** Display sort: group by suit, low→high, trumps last so they read clearly. */
function sortHand(cards: Card[], trump: Suit | null): Card[] {
  return cards.slice().sort((a, b) => {
    const at = trump && a.suit === trump ? 1 : 0;
    const bt = trump && b.suit === trump ? 1 : 0;
    if (at !== bt) return at - bt;
    if (a.suit !== b.suit) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    return a.value - b.value;
  });
}

/** The local human's table view for a Deberc hand (bidding + 9-trick play). */
export default function DebercGameScreen({ state, humanId, apply, onExit, notice, disconnectedSeats, declareSecondsLeft }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);

  const me = state.players.find((p) => p.id === humanId)!;
  const meSeat = me.seatIndex;
  const n = state.players.length;
  const myTeam = state.teamOf[meSeat];
  const isMyTurn = getActingDebercPlayerId(state) === humanId;
  const phase = state.phase;
  const trump = state.trumpSuit;
  const trumpSuit = trump ?? state.tableTrumpCard.suit;
  const trumpRed = trumpSuit === 'hearts' || trumpSuit === 'diamonds';

  // Legal plays only matter on my playing turn (redaction keeps my hand real).
  const legal = isMyTurn && phase === 'playing' ? currentLegalPlays(state) : [];
  const cardEnabled = (c: Card) => legal.some((x) => cardEquals(x, c));

  function clickCard(c: Card) {
    if (!isMyTurn || phase !== 'playing' || !cardEnabled(c)) return;
    apply({ type: 'PLAY_CARD', card: c });
  }

  const myBid = phase === 'bidding' && state.bidderSeat === meSeat;
  const otherSuits = ALL_SUITS.filter((s) => s !== state.tableTrumpCard.suit);

  // --- Declaring phase (v1.2): a BLUFF — buttons are always shown, NOT gated by
  // what I actually hold. Claiming a meld I do not have costs my team −50 (§4).
  const myDeclare = phase === 'declaring' && state.meldTurnSeat === meSeat;
  const kindLabel = (kind: DebercMeldKind) =>
    kind === 'deberc' ? t('deberc.meldDeberc')
      : kind === 'platina' ? t('deberc.meldPlatina')
        : kind === 'bella' ? t('deberc.meldBella')
          : t('deberc.meldTerz');
  // Which kinds the human has toggled on to claim; reset when the turn changes.
  const [claims, setClaims] = useState<DebercMeldKind[]>([]);
  useEffect(() => { setClaims([]); }, [phase, state.meldTurnSeat]);
  const toggleClaim = (k: DebercMeldKind) =>
    setClaims((cs) => (cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]));

  /** A seat's latest bid this hand as a tag (during bidding): passed / took trump. */
  function seatBidTag(seat: number) {
    if (phase !== 'bidding') return null;
    const seatBids = state.bids.filter((b) => b.seatIndex === seat);
    const last = seatBids[seatBids.length - 1];
    if (!last) return null;
    return last.suit == null
      ? <span className="durak-seat__bid deberc-bid--pass">{t('deberc.passed')}</span>
      : <span className="durak-seat__bid deberc-bid--took">{t('deberc.tookTrump')} {SUIT_SYMBOL[last.suit]}</span>;
  }

  // Opponents in PLAY ORDER (clockwise from the seat after me).
  const opponents = Array.from({ length: n - 1 }, (_, k) => state.players[(meSeat + 1 + k) % n]);
  const offline = (seat: number) => (disconnectedSeats ?? []).includes(seat);

  const actorSeat = phase === 'bidding' ? state.bidderSeat
    : phase === 'declaring' ? state.meldTurnSeat
      : phase === 'playing' ? state.turnSeat : -1;
  const actor = actorSeat >= 0 ? state.players[actorSeat] : null;
  const teamName = (team: number) =>
    state.players.filter((p) => state.teamOf[p.seatIndex] === team).map((p) => p.name).join(' & ');

  const waitMsg = actor
    ? offline(actor.seatIndex) ? `${actor.name} ${t('deberc.offlineAI')}`
      : actor.type === 'ai' ? t('deberc.botThinking')
        : `${t('deberc.waiting')} ${actor.name}…`
    : '';

  const prompt = phase === 'trick_complete' ? t('deberc.trickComplete')
    : phase === 'hand_scoring' ? t('deberc.handScoring')
      : !isMyTurn ? waitMsg
        : phase === 'declaring' ? t('deberc.declarePrompt')
          : phase === 'bidding' ? (state.bidRound === 1 ? t('deberc.bidRound1') : t('deberc.bidRound2'))
            : (state.currentTrick == null || state.currentTrick.plays.length === 0) ? t('deberc.leadTrick')
              : t('deberc.playCard');

  const noticeText = notice?.kind === 'trick' ? `${notice.winner} ✓` : null;
  const trickPlays = state.currentTrick?.plays ?? [];

  return (
    <div className="screen durak-screen">
      {showHelp && <DebercHelp onClose={() => setShowHelp(false)} />}
      <div className="durak-topbar">
        <button type="button" className="btn btn--ghost durak-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className={`durak-trump ${trumpRed ? 'durak-trump--red' : ''}`}>
          {t('deberc.trump')} <strong>{SUIT_SYMBOL[trumpSuit]}</strong>
          {trump == null && <em className="deberc-trump__pending"> ?</em>}
        </span>
        <button type="button" className="btn btn--ghost durak-help-btn" onClick={() => setShowHelp(true)} aria-label={t('deberc.howToPlay')}>❓</button>
      </div>

      {/* Match score strip: one chip per team, ХВ / бейт marks shown. */}
      <div className="deberc-scores" role="status">
        {state.matchScore.map((sc, team) => (
          <span key={team} className={`tag ${team === myTeam ? 'tag--ok' : ''}`}>
            {teamName(team)} · <strong>{sc}</strong>
            {state.hvMarks[team] > 0 && <span className="deberc-mark"> · {t('deberc.hv')}×{state.hvMarks[team]}</span>}
            {state.beitMarks[team] > 0 && <span className="deberc-mark"> · {t('deberc.beit')}×{state.beitMarks[team]}</span>}
          </span>
        ))}
        <span className="tag">{t('deberc.target')} {state.matchSize === 'big' ? 1020 : 510}</span>
      </div>

      {/* What each seat CLAIMED this hand — visible to everyone (immersive). Truth
          vs bluff is only revealed in the score table at hand end. */}
      {state.declaredClaims.some((c) => c.length > 0) && (
        <div className="deberc-declared" role="status">
          {state.declaredClaims.map((seatClaims, seat) => (seatClaims.length === 0 ? null : (
            <span key={seat} className={`tag deberc-declared__item ${seatClaims.includes('deberc') ? 'deberc-declared__item--jackpot' : ''}`}>
              {t('deberc.declaredBy')} {state.players[seat]?.name} · {seatClaims.map(kindLabel).join(', ')}
            </span>
          )))}
        </div>
      )}

      <div className={`durak-board durak-board--${n}`}>
        <div className="durak-board__felt" aria-hidden="true" />
        {opponents.map((p, k) => {
          const isOffline = offline(p.seatIndex);
          const isActing = p.seatIndex === actorSeat;
          const isObjaz = p.seatIndex === state.objazSeat;
          const isDealer = p.seatIndex === state.dealerSeat;
          const pos = (SEAT_LAYOUT[n] ?? SEAT_LAYOUT[4])[k + 1];
          return (
            <div key={p.id} className={`durak-seat durak-seat--${pos} ${isOffline ? 'durak-seat--offline' : ''} ${isActing ? 'durak-seat--acting' : ''}`}>
              <span className="durak-seat__name">
                {isOffline && <span className="durak-seat__off" aria-label={t('common.offline')}>📴 </span>}{p.name}
              </span>
              <span className="durak-seat__count">🂠 {p.hand.length}</span>
              <span className="durak-seat__roles">
                {isDealer && <span className="durak-seat__role deberc-role--dealer">{t('deberc.dealer')}</span>}
                {isObjaz && <span className="durak-seat__role deberc-role--objaz">{t('deberc.objaz')}</span>}
              </span>
              {seatBidTag(p.seatIndex)}
            </div>
          );
        })}
        <div className="durak-centre">
          {noticeText && <div className="durak-notice" role="status">{noticeText}</div>}
          {/* The face-up trump card is on the table only during bidding, or (3p)
              while it sits on the stock. For 4p after the прикуп it is in the
              dealer's hand — show the suit only, so it never appears twice. */}
          <DebercDeck
            count={state.stock.length}
            trumpCard={phase === 'bidding' || n === 3 ? state.tableTrumpCard : null}
            trumpSuit={trump}
          />
          <div className="durak-table__cards">
            {trickPlays.length === 0
              ? <p className="durak-table__empty">·</p>
              : trickPlays.map((play, i) => {
                const isWinner = state.currentTrick?.winnerSeat === play.seatIndex;
                return (
                  <div className="durak-pair" key={i}>
                    <CardView card={play.card} size="table" disabled highlight={isWinner} />
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <div className={`durak-prompt ${isMyTurn ? 'durak-prompt--me' : ''}`}>
        {meSeat === state.dealerSeat && <span className="durak-youare deberc-role--dealer">{t('deberc.dealer')}</span>}
        {meSeat === state.objazSeat && <span className="durak-youare durak-youare--atk">{t('deberc.objaz')}</span>}
        {seatBidTag(meSeat)}
        <span className="durak-prompt__text">{prompt}</span>
      </div>

      {/* Bidding controls (only on my bid turn). */}
      {myBid && (
        <div className="durak-controls">
          {state.bidRound === 1 ? (
            <>
              <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'BID', suit: state.tableTrumpCard.suit })}>
                {t('deberc.bidTakeTrump')} {SUIT_SYMBOL[state.tableTrumpCard.suit]}
              </button>
              <button type="button" className="btn btn--outline" onClick={() => apply({ type: 'BID', suit: null })}>{t('deberc.bidPass')}</button>
            </>
          ) : (
            <>
              <span className="durak-prompt__text">{t('deberc.bidPickSuit')}</span>
              {otherSuits.map((s) => {
                const red = s === 'hearts' || s === 'diamonds';
                return (
                  <button key={s} type="button" className={`btn btn--outline deberc-suit ${red ? 'deberc-suit--red' : ''}`} onClick={() => apply({ type: 'BID', suit: s })}>
                    {SUIT_SYMBOL[s]}
                  </button>
                );
              })}
              <button type="button" className="btn btn--ghost" onClick={() => apply({ type: 'BID', suit: null })}>{t('deberc.bidPass')}</button>
            </>
          )}
        </div>
      )}

      {/* Declaring controls (only on my declaring turn) — a BLUFF: the four
          buttons are ALWAYS available, never gated by what I actually hold. */}
      {myDeclare && (
        <div className="durak-controls deberc-declare">
          <span className="deberc-declare__warn" role="note">
            {declareSecondsLeft != null && <strong className="deberc-declare__timer" aria-live="polite">⏱ {declareSecondsLeft}s</strong>}
            {' '}{t('deberc.bluffWarn')}
          </span>
          <div className="deberc-declare__buttons">
            {ALL_MELD_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`btn deberc-meld-chip ${claims.includes(k) ? 'btn--primary' : 'btn--outline'} ${k === 'deberc' ? 'deberc-meld-chip--jackpot' : ''}`}
                aria-pressed={claims.includes(k)}
                onClick={() => toggleClaim(k)}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'DECLARE_MELD', claims })}>
            {t('deberc.declareConfirm')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => apply({ type: 'DECLARE_MELD', claims: [] })}>
            {t('deberc.declarePass')}
          </button>
        </div>
      )}

      <div className="durak-hand">
        {sortHand(me.hand, trump).map((c, i) => (
          <CardView
            key={`${c.rank}${c.suit}${i}`}
            card={c}
            size="hand"
            onClick={() => clickCard(c)}
            disabled={phase !== 'playing' || !cardEnabled(c)}
            dimmed={isMyTurn && phase === 'playing' && !cardEnabled(c)}
          />
        ))}
      </div>
    </div>
  );
}
