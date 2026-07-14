import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import type { Card, Suit } from '../../models/types';
import type { DebercAction, DebercMeld, DebercMeldKind, DebercState } from '../../games/deberc/types';
import { currentLegalPlays, getActingDebercPlayerId } from '../../games/deberc/engine';
import { cardEquals, canExchangeTrump } from '../../games/deberc/rules';
import { detectAllSequences, hasBella } from '../../games/deberc/melds';
import DebercDeck from './DebercDeck';
import DebercHelp from './DebercHelp';
import HandOrderControls from '../components/HandOrderControls';
import { useManualHandOrder, singleDeckCardId } from '../../hooks/useManualHandOrder';
import DebercScoreTable from './DebercScoreTable';
import DebercTricksReview from './DebercTricksReview';

/** Nominal (top card) label for a declared meld — from its cards, or its topValue. */
const VALUE_TO_RANK: Record<number, string> = { 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

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
  const [showScore, setShowScore] = useState(false);
  const [showTricks, setShowTricks] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(false);

  // First-dealer intro (§3): shown on hand 1 only, auto-hides after a few seconds.
  const draw = state.firstDealerDraw;
  const showIntro = !introDismissed && state.handHistory.length === 0 && draw != null;
  useEffect(() => {
    if (!showIntro) return;
    const tmr = setTimeout(() => setIntroDismissed(true), 6500);
    return () => clearTimeout(tmr);
  }, [showIntro]);

  const me = state.players.find((p) => p.id === humanId)!;
  const meSeat = me.seatIndex;
  const n = state.players.length;
  /** Tricks a seat has taken this hand (n cards per trick). */
  const tricksOf = (seat: number) => Math.floor(state.wonCards[seat].length / n);
  const myTeam = state.teamOf[meSeat];
  const isMyTurn = getActingDebercPlayerId(state) === humanId;
  const phase = state.phase;
  const trump = state.trumpSuit;
  const trumpSuit = trump ?? state.tableTrumpCard.suit;
  // Client-only hand display order (default = sortHand; manual on reorder, Stage 30.12).
  const handOrder = useManualHandOrder(sortHand(me.hand, trump), singleDeckCardId);
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

  // --- Declaring phase (v1.3): TRUTHFUL — chips list only the melds I actually
  // hold (each with its nominal). Among equal kinds the highest nominal reveals &
  // scores; lower holders do not reveal. No bluff.
  const myDeclare = phase === 'declaring' && state.meldTurnSeat === meSeat;
  // Trump exchange (Stage 27.2): on my declaring turn, if I hold the low trump I may swap it for
  // the face-up table trump before declaring. A public note shows once it happened.
  const canExchange = canExchangeTrump(state, meSeat);
  const exchangedByName = state.trumpExchangedBy != null ? state.players[state.trumpExchangedBy]?.name : null;
  const kindLabel = (kind: DebercMeldKind) =>
    kind === 'deberc' ? t('deberc.meldDeberc')
      : kind === 'platina' ? t('deberc.meldPlatina')
        : kind === 'bella' ? t('deberc.meldBella')
          : t('deberc.meldTerz');
  const meldNominal = (m: DebercMeld) =>
    m.cards.length ? m.cards[m.cards.length - 1].rank : (VALUE_TO_RANK[m.topValue] ?? '');
  const meldLabel = (m: DebercMeld) =>
    m.kind === 'bella' ? kindLabel(m.kind) : `${kindLabel(m.kind)} ${t('deberc.meldTo')} ${meldNominal(m)}`;
  // The real melds I can announce this turn (sequences + bella), from my own hand.
  const myHand = state.dealtHands[meSeat] ?? me.hand;
  const myMelds: DebercMeld[] = myDeclare
    ? [
      ...detectAllSequences(myHand, meSeat, trump),
      ...(hasBella(myHand, trump)
        ? [{ seatIndex: meSeat, kind: 'bella' as const, points: 20, cards: [] as Card[], topValue: 0, isTrump: true, revealed: false }]
        : []),
    ]
    : [];
  // Which of my held melds I've toggled to announce; reset when the turn changes.
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => { setPicked([]); }, [phase, state.meldTurnSeat]);
  const togglePick = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  const announce = () => apply({
    type: 'DECLARE_MELD',
    melds: picked.map((i) => {
      const m = myMelds[i];
      // Pass the run's suit so two same-kind sequences (e.g. two терці) are both
      // declarable and never collapse into one (owner rule 2026-07-08).
      return m.kind === 'bella'
        ? { kind: 'bella' as const }
        : { kind: m.kind, topRank: m.cards[m.cards.length - 1].rank, suit: m.cards[0].suit };
    }),
  });

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
    <div className="screen durak-screen deberc-screen">
      {showHelp && <DebercHelp onClose={() => setShowHelp(false)} />}
      {showScore && <DebercScoreTable state={state} onClose={() => setShowScore(false)} />}
      {showTricks && <DebercTricksReview state={state} mySeat={meSeat} onClose={() => setShowTricks(false)} />}
      {showIntro && draw && (
        <div className="deberc-firstdealer" role="dialog" aria-label={t('deberc.firstDealer')} onClick={() => setIntroDismissed(true)}>
          <div className="deberc-firstdealer__card" onClick={(e) => e.stopPropagation()}>
            <h3 className="deberc-firstdealer__title">{t('deberc.firstDealer')}</h3>
            <div className="deberc-firstdealer__seats">
              {draw.suitOf.map((suit, seat) => {
                const isDrawn = suit === draw.drawnSuit;
                const red = suit === 'hearts' || suit === 'diamonds';
                const isMe = seat === meSeat;
                return (
                  <div key={seat} className={`deberc-firstdealer__seat ${isDrawn ? 'deberc-firstdealer__seat--drawn' : ''}`}>
                    <span className={`deberc-firstdealer__suit ${red ? 'deberc-firstdealer__suit--red' : ''}`}>{SUIT_SYMBOL[suit]}</span>
                    <span className="deberc-firstdealer__seatname">{state.players[seat]?.name}{isMe ? ` (${t('deberc.you')})` : ''}</span>
                  </div>
                );
              })}
            </div>
            <p className="deberc-firstdealer__drawn">
              {t('deberc.drawnSuit')} <strong className={draw.drawnSuit === 'hearts' || draw.drawnSuit === 'diamonds' ? 'deberc-firstdealer__suit--red' : ''}>{SUIT_SYMBOL[draw.drawnSuit]}</strong>
              {' → '}<strong>{state.players[state.dealerSeat]?.name}</strong> {t('deberc.dealsFirst')}
            </p>
            {/* Show BOTH facts distinctly (owner request 2026-07-08): the trump card
                that came up on the table, and who holds the first об'яз (= first
                dealer this hand) — with a "you" marker so it is never mistaken for
                another seat. Note the об'яз can still change during bidding. */}
            <p className="deberc-firstdealer__objaz">
              {t('deberc.firstObjazIs')} <strong>{state.players[state.objazSeat]?.name}</strong>
              {state.objazSeat === meSeat ? ` (${t('deberc.you')})` : ''}
            </p>
            <div className="deberc-firstdealer__trump">
              <span className="deberc-firstdealer__trumplabel">{t('deberc.tableTrumpUp')}</span>
              <CardView card={state.tableTrumpCard} size="mini" disabled />
            </div>
            <button type="button" className="btn btn--primary" onClick={() => setIntroDismissed(true)}>{t('deberc.gotIt')}</button>
          </div>
        </div>
      )}
      <div className="durak-topbar">
        <button type="button" className="btn btn--ghost durak-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className={`durak-trump ${trumpRed ? 'durak-trump--red' : ''}`}>
          {t('deberc.trump')} <strong>{SUIT_SYMBOL[trumpSuit]}</strong>
          {trump == null && <em className="deberc-trump__pending"> ?</em>}
        </span>
        <span className="durak-topbar__btns">
          <button type="button" className="btn btn--ghost durak-help-btn" onClick={() => setShowScore(true)} aria-label={t('deberc.scoreTable')}>📊</button>
          <button type="button" className="btn btn--ghost durak-help-btn" onClick={() => setShowTricks(true)} aria-label={t('deberc.myTricks')}>🃏</button>
          <button type="button" className="btn btn--ghost durak-help-btn" onClick={() => setShowHelp(true)} aria-label={t('deberc.howToPlay')}>❓</button>
        </span>
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

      {/* What each seat ANNOUNCED this hand (kind + nominal) — public to everyone.
          The §4 winner (✓ revealed) also DEMONSTRATES the actual cards to all. */}
      {state.declaredMelds.length > 0 && (
        <div className="deberc-declared" role="status">
          {[...new Set(state.declaredMelds.map((m) => m.seatIndex))].map((seat) => {
            const ms = state.declaredMelds.filter((m) => m.seatIndex === seat);
            // Revealed sequence cards the winner must show everyone (bella has none here).
            const shown = ms.filter((m) => m.revealed && m.cards.length > 0);
            return (
              <span key={seat} className={`tag deberc-declared__item ${ms.some((m) => m.kind === 'deberc') ? 'deberc-declared__item--jackpot' : ''}`}>
                {t('deberc.declaredBy')} {state.players[seat]?.name} · {ms.map((m) => `${meldLabel(m)}${m.revealed ? ' ✓' : ''}`).join(', ')}
                {shown.length > 0 && (
                  <span className="deberc-declared__cards">
                    {shown.flatMap((m) => m.cards).map((c, i) => (
                      <CardView key={`${c.rank}${c.suit}${i}`} card={c} size="mini" disabled />
                    ))}
                  </span>
                )}
              </span>
            );
          })}
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
              <span className="durak-seat__count">🂠 {p.hand.length} · 🃏 {tricksOf(p.seatIndex)}</span>
              <span className="durak-seat__roles">
                {isDealer && <span className="durak-seat__role deberc-role--dealer">{t('deberc.dealer')}</span>}
                {isObjaz && <span className="durak-seat__role deberc-role--objaz">{t('deberc.objaz')}</span>}
                {isObjaz && state.objazSeat !== state.dealerSeat && (
                  <span className="durak-seat__role deberc-role--intercept" title={t('deberc.intercepted')}>{t('deberc.intercepted')}</span>
                )}
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
                    <CardView card={play.card} size="table" disabled highlight={isWinner} lead={i === 0} />
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <div className={`durak-prompt ${isMyTurn ? 'durak-prompt--me' : ''}`}>
        {meSeat === state.dealerSeat && <span className="durak-youare deberc-role--dealer">{t('deberc.dealer')}</span>}
        {meSeat === state.objazSeat && <span className="durak-youare durak-youare--atk">{t('deberc.objaz')}</span>}
        {meSeat === state.objazSeat && state.objazSeat !== state.dealerSeat && (
          <span className="durak-youare deberc-role--intercept">{t('deberc.intercepted')}</span>
        )}
        {seatBidTag(meSeat)}
        <span className="durak-prompt__text">{prompt}</span>
        <button type="button" className="btn btn--ghost deberc-mytricks" onClick={() => setShowTricks(true)} aria-label={t('deberc.reviewTricks')}>
          🃏 {tricksOf(meSeat)}
        </button>
      </div>

      {/* Public trump-exchange note (Stage 27.2) — no hidden-hand detail, just the public swap. */}
      {state.trumpExchanged && exchangedByName && (state.phase === 'declaring' || state.phase === 'playing') && (
        <p className="deberc-exchange-note" role="status">🔄 <strong>{exchangedByName}</strong> {t('deberc.exchangedLowTrump')}</p>
      )}

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

      {/* Declaring controls (only on my declaring turn) — TRUTHFUL (v1.3): chips
          list only the melds I actually hold, each with its nominal. */}
      {myDeclare && (
        <div className="durak-controls deberc-declare">
          <span className="deberc-declare__warn" role="note">
            {declareSecondsLeft != null && <strong className="deberc-declare__timer" aria-live="polite">⏱ {declareSecondsLeft}s</strong>}
            {' '}{t('deberc.declareHint')}
          </span>
          {/* Trump exchange (Stage 27.2): swap the low trump for the face-up table trump first. */}
          {canExchange && (
            <button type="button" className="btn btn--outline deberc-exchange-trump" onClick={() => apply({ type: 'EXCHANGE_TRUMP' })}>
              🔄 {t('deberc.exchangeTrump')}
            </button>
          )}
          <div className="deberc-declare__buttons">
            {myMelds.length === 0 && <span className="deberc-declare__none">{t('deberc.noMelds')}</span>}
            {myMelds.map((m, i) => (
              <button
                key={i}
                type="button"
                className={`btn deberc-meld-chip ${picked.includes(i) ? 'btn--primary' : 'btn--outline'} ${m.kind === 'deberc' ? 'deberc-meld-chip--jackpot' : ''}`}
                aria-pressed={picked.includes(i)}
                onClick={() => togglePick(i)}
              >
                {meldLabel(m)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--primary" disabled={picked.length === 0} onClick={announce}>
            {t('deberc.declareConfirm')}
          </button>
          {/* Skip meld declaration — destructive/red so it reads clearly as "give up" (Stage 27.0). */}
          <button type="button" className="btn btn--danger deberc-skip-meld" onClick={() => apply({ type: 'DECLARE_MELD', melds: [] })}>
            {t('deberc.declarePass')}
          </button>
        </div>
      )}

      <div className="durak-hand">
        {handOrder.ordered.map((c) => (
          <CardView
            key={singleDeckCardId(c)}
            card={c}
            size="hand"
            onClick={() => clickCard(c)}
            disabled={phase !== 'playing' || !cardEnabled(c)}
            dimmed={isMyTurn && phase === 'playing' && !cardEnabled(c)}
          />
        ))}
      </div>
      <HandOrderControls order={handOrder} cardId={singleDeckCardId}
        renderMini={(c) => <CardView card={c} size="mini" disabled />} />
    </div>
  );
}
