import { useState } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import type { Card, Suit } from '../../models/types';
import type { TarneebAction, TarneebState, TarneebTrick } from '../../games/tarneeb/types';
import {
  cardEquals,
  getActingTarneebSeat,
  getValidBids,
  getValidPlayableCards,
  isSoloTarneeb,
  teamOfSeat,
} from '../../games/tarneeb/rules';
import { TARNEEB_SUITS } from '../../games/tarneeb/deck';
import TarneebHelp from './TarneebHelp';
import TarneebTricksReview from './TarneebTricksReview';

interface Props {
  state: TarneebState;
  /** The human's seat (0 in the local game; the client's own seat online). */
  humanSeat: number;
  apply: (a: TarneebAction) => void;
  onExit: () => void;
  /** A just-resolved trick shown briefly in the centre (blocks input while set). */
  reviewTrick: TarneebTrick | null;
  /** Online mode: the SERVER drives bots + the hand_complete advance, so the
   *  "Next hand" button is hidden (a note shows instead). Default false (local). */
  online?: boolean;
  /** Seats whose human is offline (online only) — for offline badges / hints. */
  disconnectedSeats?: number[];
}

/** Seat positions around the felt by RELATIVE offset from the viewer (bottom).
 *  Tarneeb's internal seat order is counter-clockwise BY INDEX (0→3→2→1, TARNEEB_RULES
 *  §2), but the owner wants play to READ clockwise on screen. We map the *engine*
 *  successor (seat−1) to the LEFT slot, so the turn sweeps bottom → left → top → right
 *  (clockwise) while the partner (offset 2) still sits opposite at the top. UI-only:
 *  dealing, partnerships, scoring and the play order itself are unchanged — only the
 *  left/right screen placement mirrors. See CLOCKWISE_AUDIT.md. */
const POSITIONS = ['bottom', 'left', 'top', 'right'] as const;
type SeatPos = (typeof POSITIONS)[number];
function seatPosition(seat: number, viewerSeat: number): SeatPos {
  return POSITIONS[(viewerSeat - seat + 4) % 4];
}

const SUIT_ORDER: Record<Suit, number> = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };

/** Group by suit, low→high; the trump suit (once known) sits last for clarity. */
function sortHand(cards: Card[], trump: Suit | null): Card[] {
  return cards.slice().sort((a, b) => {
    const at = trump && a.suit === trump ? 1 : 0;
    const bt = trump && b.suit === trump ? 1 : 0;
    if (at !== bt) return at - bt;
    if (a.suit !== b.suit) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    return a.value - b.value;
  });
}

const isRed = (s: Suit) => s === 'hearts' || s === 'diamonds';

/** The local human's table view for one Tarneeb hand. */
export default function TarneebGameScreen({ state, humanSeat, apply, onExit, reviewTrick, online = false, disconnectedSeats }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);
  const [showTricks, setShowTricks] = useState(false);

  // Solo (Stage 28.3): 4-player cutthroat — every seat is its own side. Scores/tricks
  // come from the per-seat ledgers, not the A/B team ledgers. Pairs is unchanged.
  const solo = isSoloTarneeb(state);
  const scoresBySeat = state.scoresBySeat ?? [0, 0, 0, 0];
  const tricksBySeat = state.tricksBySeat ?? [0, 0, 0, 0];
  const myTeam = teamOfSeat(humanSeat);
  const theirTeam = myTeam === 'A' ? 'B' : 'A';
  const myTricks = solo ? tricksBySeat[humanSeat] : state.tricksByTeam[myTeam];
  const topScore = solo ? Math.max(...scoresBySeat) : 0;
  const actingSeat = getActingTarneebSeat(state);
  const blocked = reviewTrick != null || state.phase === 'hand_complete';
  const isMyTurn = actingSeat === humanSeat && !blocked;
  const phase = state.phase;
  const offline = (seat: number) => (disconnectedSeats ?? []).includes(seat);

  // Last standing bid per seat (for the seat plates during the auction).
  const lastBidBySeat: (number | null)[] = [null, null, null, null];
  for (const b of state.bids) if (b.amount != null) lastBidBySeat[b.seat] = b.amount;

  const legalCards = phase === 'playing' && isMyTurn ? getValidPlayableCards(state, humanSeat) : [];
  const cardEnabled = (c: Card) => legalCards.some((x) => cardEquals(x, c));

  function clickCard(c: Card) {
    if (!isMyTurn || phase !== 'playing' || !cardEnabled(c)) return;
    apply({ type: 'PLAY_CARD', card: c });
  }

  const trick = reviewTrick ?? state.currentTrick;
  const trumpRed = state.trumpSuit != null && isRed(state.trumpSuit);

  // One clear instruction for the current moment.
  const actor = actingSeat != null ? state.players[actingSeat] : null;
  const actorOffline = actingSeat != null && offline(actingSeat);
  // What an OPPONENT's turn reads as: an offline human (AI may substitute), a bot
  // thinking (phase-specific), or just waiting for a connected human.
  const waitFor = (botKey: string) =>
    actorOffline ? `${actor?.name} ${t('tarneeb.offlineAI')}`
      : actor?.type === 'ai' ? t(botKey)
        : actor ? `${t('tarneeb.waiting')} ${actor.name}…` : '';
  let prompt = '';
  if (blocked) prompt = '';
  else if (phase === 'bidding') prompt = isMyTurn ? t('tarneeb.yourBid') : waitFor('tarneeb.botBidding');
  else if (phase === 'choosing_trump') prompt = isMyTurn ? t('tarneeb.yourTrump') : waitFor('tarneeb.botChoosingTrump');
  else if (phase === 'playing') prompt = isMyTurn ? t('tarneeb.yourPlay') : waitFor('tarneeb.botThinking');

  const validBids = phase === 'bidding' && isMyTurn ? getValidBids(state, humanSeat) : [];

  // Extra readouts for a clearer table (Stage 10.6 polish):
  const highBidderName = state.highestBid
    ? state.highestBid.seat === humanSeat
      ? t('tarneeb.you')
      : state.players[state.highestBid.seat].name
    : null;
  const ledSuit = state.currentTrick?.ledSuit ?? null;
  // The human has passed and is out of the current auction (make it obvious).
  const iPassed = phase === 'bidding' && state.passed[humanSeat] && !isMyTurn;
  // Follow-suit reminder: it is my turn to play, a suit is led, and I hold it.
  const mustFollow =
    phase === 'playing' && isMyTurn && ledSuit != null &&
    state.handsBySeat[humanSeat].some((c) => c.suit === ledSuit);

  return (
    <div className={`screen tarneeb-screen ${online ? 'tarneeb-screen--online' : ''}`}>
      {showHelp && <TarneebHelp onClose={() => setShowHelp(false)} />}
      {showTricks && <TarneebTricksReview state={state} mySeat={humanSeat} onClose={() => setShowTricks(false)} />}

      <div className="tarneeb-topbar">
        <button type="button" className="btn btn--ghost tarneeb-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className="tarneeb-phase">{t(`tarneeb.phase.${phaseKey(phase)}`)}</span>
        {/* Review my team's taken tricks (Stage 27.3) — available once any trick has been won. */}
        <button type="button" className="btn btn--ghost tarneeb-tricks-btn" onClick={() => setShowTricks(true)}
          aria-label={t('tarneeb.reviewTricks')} title={t('tarneeb.reviewTricks')}>
          🃏 {myTricks}
        </button>
        <button type="button" className="btn btn--ghost tarneeb-help-btn" onClick={() => setShowHelp(true)} aria-label={t('tarneeb.howToPlay')}>❓</button>
      </div>

      {/* Scoreboard: target, trump, bid, tricks + scores. Solo shows a 4-player
          standings strip (every player for themselves); Pairs shows the two teams. */}
      {(() => {
        const mid = (
          <div className="tarneeb-scoreboard__mid">
            <span className="tarneeb-target">🎯 {state.targetScore}</span>
            <span className={`tarneeb-trump ${trumpRed ? 'tarneeb-trump--red' : ''}`}>
              {t('tarneeb.trump')} <strong>{state.trumpSuit ? SUIT_SYMBOL[state.trumpSuit] : '—'}</strong>
            </span>
            <span className="tarneeb-bid">
              {t('tarneeb.highestBid')}:{' '}
              <strong>{state.highestBid ? state.highestBid.amount : t('tarneeb.noBid')}</strong>
              {highBidderName && <span className="tarneeb-bid__by"> · {highBidderName}</span>}
            </span>
            {phase === 'playing' && ledSuit && (
              <span className={`tarneeb-led ${isRed(ledSuit) ? 'tarneeb-led--red' : ''}`}>
                {t('tarneeb.led')} <strong>{SUIT_SYMBOL[ledSuit]}</strong>
              </span>
            )}
            {phase === 'playing' && (
              solo ? (
                <span className="tarneeb-tricks">{t('tarneeb.myTricks')}: <strong>{myTricks}</strong></span>
              ) : (
                <span className="tarneeb-tricks">
                  {t('tarneeb.tricks')}: <strong>{state.tricksByTeam[myTeam]}</strong> – <strong>{state.tricksByTeam[theirTeam]}</strong>
                </span>
              )
            )}
          </div>
        );
        if (solo) {
          return (
            <div className="tarneeb-scoreboard tarneeb-scoreboard--solo">
              {mid}
              <div className="tarneeb-solo-standings" role="list">
                {state.players.map((p) => {
                  const isMe = p.seatIndex === humanSeat;
                  const lead = scoresBySeat[p.seatIndex] === topScore;
                  return (
                    <div key={p.id} role="listitem"
                      className={`tarneeb-solo-chip ${isMe ? 'tarneeb-solo-chip--me' : ''} ${lead ? 'tarneeb-solo-chip--lead' : ''}`}>
                      <span className="tarneeb-solo-chip__name">{isMe ? t('tarneeb.you') : p.name}</span>
                      <span className="tarneeb-solo-chip__score">{scoresBySeat[p.seatIndex]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        return (
          <div className="tarneeb-scoreboard">
            <div className="tarneeb-score tarneeb-score--us">
              <span className="tarneeb-score__label">{t('tarneeb.teamUs')}</span>
              <span className="tarneeb-score__value">{state.scoresByTeam[myTeam]}</span>
            </div>
            {mid}
            <div className="tarneeb-score tarneeb-score--them">
              <span className="tarneeb-score__label">{t('tarneeb.teamThem')}</span>
              <span className="tarneeb-score__value">{state.scoresByTeam[theirTeam]}</span>
            </div>
          </div>
        );
      })()}

      {/* Round table: seats around the felt in play order, trick in the centre. */}
      <div className="tarneeb-board">
        <div className="tarneeb-board__felt" aria-hidden="true" />
        {state.players.map((p) => {
          const pos = seatPosition(p.seatIndex, humanSeat);
          // Solo: only my own seat is "us" (everyone else is an independent opponent).
          const sameTeam = solo ? p.seatIndex === humanSeat : teamOfSeat(p.seatIndex) === myTeam;
          const isActing = p.seatIndex === actingSeat && !blocked;
          const isDealer = p.seatIndex === state.dealerSeat;
          const isDeclarer = p.seatIndex === state.declarerSeat;
          const isOffline = p.seatIndex !== humanSeat && offline(p.seatIndex);
          const bidLabel = phase === 'bidding'
            ? (state.passed[p.seatIndex] ? t('tarneeb.passed') : lastBidBySeat[p.seatIndex] != null ? String(lastBidBySeat[p.seatIndex]) : '')
            : '';
          return (
            <div
              key={p.id}
              className={`tarneeb-seat tarneeb-seat--${pos} tarneeb-seat--${sameTeam ? 'us' : 'them'} ${isActing ? 'tarneeb-seat--acting' : ''} ${isOffline ? 'tarneeb-seat--offline' : ''}`}
            >
              <span className="tarneeb-seat__badges">
                {isDealer && <span className="tarneeb-badge tarneeb-badge--dealer" title={t('tarneeb.dealer')}>D</span>}
                {isDeclarer && <span className="tarneeb-badge tarneeb-badge--declarer" title={t('tarneeb.declarer')}>★</span>}
              </span>
              <span className="tarneeb-seat__name">
                {isOffline && <span className="tarneeb-seat__off" aria-label={t('common.offline')}>📴 </span>}
                {p.seatIndex === humanSeat ? t('tarneeb.you') : p.name}
              </span>
              <span className="tarneeb-seat__meta">
                {p.seatIndex === humanSeat && !solo
                  ? <span className="tarneeb-seat__team">{t('tarneeb.teamUs')}</span>
                  : <span className="tarneeb-seat__count">🂠 {state.handsBySeat[p.seatIndex].length}</span>}
              </span>
              {bidLabel && <span className="tarneeb-seat__bid">{bidLabel}</span>}
            </div>
          );
        })}

        <div className="tarneeb-centre">
          {trick && trick.plays.length > 0 ? (
            trick.plays.map((play) => {
              const pos = seatPosition(play.seat, humanSeat);
              const winning = reviewTrick != null && reviewTrick.winnerSeat === play.seat;
              const lead = play.seat === trick.leadSeat; // the card that led this trick (Stage 27.0)
              return (
                <div key={play.seat} className={`tarneeb-play tarneeb-play--${pos}`}>
                  <CardView card={play.card} size="table" disabled highlight={winning} lead={lead} />
                </div>
              );
            })
          ) : (
            <p className="tarneeb-centre__empty">{phase === 'playing' && isMyTurn ? '·' : ''}</p>
          )}
        </div>
      </div>

      <div className={`tarneeb-prompt ${isMyTurn ? 'tarneeb-prompt--me' : ''}`}>
        <span className="tarneeb-prompt__text">{prompt}</span>
        {iPassed && <span className="tarneeb-prompt__note">{t('tarneeb.youPassed')}</span>}
        {mustFollow && <span className="tarneeb-prompt__note">{t('tarneeb.mustFollow')}</span>}
      </div>

      {/* Action area: bidding buttons, trump picker, or nothing while playing. */}
      {phase === 'bidding' && isMyTurn && (
        <div className="tarneeb-actions tarneeb-bidbar">
          {validBids.map((b) => (
            <button key={b} type="button" className="btn btn--outline tarneeb-bidbtn" onClick={() => apply({ type: 'BID', amount: b })}>
              {b}
            </button>
          ))}
          <button type="button" className="btn btn--ghost tarneeb-passbtn" onClick={() => apply({ type: 'PASS_BID' })}>
            {t('tarneeb.pass')}
          </button>
        </div>
      )}

      {phase === 'choosing_trump' && isMyTurn && (
        <div className="tarneeb-actions tarneeb-trumpbar">
          <span className="tarneeb-trumpbar__label">{t('tarneeb.chooseTrump')}</span>
          <div className="tarneeb-trumpbar__suits">
            {TARNEEB_SUITS.map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn--outline tarneeb-suitbtn ${isRed(s) ? 'tarneeb-suitbtn--red' : ''}`}
                onClick={() => apply({ type: 'CHOOSE_TRUMP', suit: s })}
                aria-label={t(`suit.${s}`)}
              >
                {SUIT_SYMBOL[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The human's hand. */}
      <div className="tarneeb-hand">
        {sortHand(state.handsBySeat[humanSeat], state.trumpSuit).map((c) => (
          <CardView
            key={`${c.rank}${c.suit}`}
            card={c}
            size="hand"
            onClick={() => clickCard(c)}
            disabled={phase !== 'playing' || !cardEnabled(c)}
            dimmed={phase === 'playing' && isMyTurn && !cardEnabled(c)}
          />
        ))}
      </div>

      {/* Hand-complete summary overlay. Online: the SERVER auto-advances, so the
          button is replaced by a "starting…" note (a client START_NEXT_HAND would
          be rejected anyway — no seat acts on this screen). */}
      {phase === 'hand_complete' && (state.lastHand || state.lastSoloHand) && (
        <HandComplete state={state} humanSeat={humanSeat} online={online} onNext={() => apply({ type: 'START_NEXT_HAND' })} />
      )}
    </div>
  );
}

function phaseKey(phase: TarneebState['phase']): string {
  switch (phase) {
    case 'bidding': return 'bidding';
    case 'choosing_trump': return 'choosingTrump';
    case 'playing': return 'playing';
    case 'hand_complete': return 'handComplete';
    default: return 'finished';
  }
}

/** The between-hands result panel (bid / trump / tricks / score delta). */
function HandComplete({ state, humanSeat, onNext, online }: {
  state: TarneebState;
  humanSeat: number;
  onNext: () => void;
  online: boolean;
}) {
  const { t } = useI18n();
  if (isSoloTarneeb(state) && state.lastSoloHand) {
    return <SoloHandComplete state={state} humanSeat={humanSeat} online={online} onNext={onNext} />;
  }
  const hand = state.lastHand!;
  const myTeam = teamOfSeat(humanSeat);
  const theirTeam = myTeam === 'A' ? 'B' : 'A';
  const usTricks = hand.declarerTeam === myTeam ? hand.declarerTricks : hand.defenderTricks;
  const themTricks = hand.declarerTeam === myTeam ? hand.defenderTricks : hand.declarerTricks;
  const declarerName = state.players[hand.declarerSeat].seatIndex === humanSeat
    ? t('tarneeb.you')
    : state.players[hand.declarerSeat].name;
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

  return (
    <div className="tarneeb-handdone-overlay" role="dialog" aria-modal="true">
      <div className="tarneeb-handdone">
        <h2 className="tarneeb-handdone__title">
          {hand.made ? `✅ ${t('tarneeb.contractMade')}` : `❌ ${t('tarneeb.contractFailed')}`}
        </h2>
        {hand.exactBidDouble && (
          <p className="tarneeb-handdone__double">✨ {t('tarneeb.exactBidDouble')}</p>
        )}
        <p className="tarneeb-handdone__line">
          <span className="tarneeb-badge tarneeb-badge--declarer">★</span> {declarerName} · {t('tarneeb.bid')} <strong>{hand.bid}</strong> · {t('tarneeb.trump')} <strong>{SUIT_SYMBOL[hand.trumpSuit]}</strong>
        </p>
        <table className="tarneeb-handdone__table">
          <thead>
            <tr><th></th><th>{t('tarneeb.tricks')}</th><th>{t('tarneeb.hand')}</th><th>{t('tarneeb.score')}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('tarneeb.teamUs')}</td>
              <td>{usTricks}</td>
              <td>{fmt(hand.deltaByTeam[myTeam])}</td>
              <td><strong>{state.scoresByTeam[myTeam]}</strong></td>
            </tr>
            <tr>
              <td>{t('tarneeb.teamThem')}</td>
              <td>{themTricks}</td>
              <td>{fmt(hand.deltaByTeam[theirTeam])}</td>
              <td><strong>{state.scoresByTeam[theirTeam]}</strong></td>
            </tr>
          </tbody>
        </table>
        {online ? (
          <p className="tarneeb-handdone__note">{t('tarneeb.nextHandSoon')}</p>
        ) : (
          <button type="button" className="btn btn--primary tarneeb-handdone__next" onClick={onNext} autoFocus>
            {t('tarneeb.nextHand')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Between-hands panel for SOLO — per-seat (no teams): declarer made/failed and
 *  every player's tricks / hand delta / running score. */
function SoloHandComplete({ state, humanSeat, onNext, online }: {
  state: TarneebState;
  humanSeat: number;
  onNext: () => void;
  online: boolean;
}) {
  const { t } = useI18n();
  const hand = state.lastSoloHand!;
  const scores = state.scoresBySeat ?? [0, 0, 0, 0];
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
  const nameOf = (seat: number) => (seat === humanSeat ? t('tarneeb.you') : state.players[seat].name);

  return (
    <div className="tarneeb-handdone-overlay" role="dialog" aria-modal="true">
      <div className="tarneeb-handdone">
        <h2 className="tarneeb-handdone__title">
          {hand.made ? `✅ ${t('tarneeb.contractMade')}` : `❌ ${t('tarneeb.contractFailed')}`}
        </h2>
        <p className="tarneeb-handdone__line">
          <span className="tarneeb-badge tarneeb-badge--declarer">★</span> {nameOf(hand.declarerSeat)} · {t('tarneeb.bid')} <strong>{hand.bid}</strong> · {t('tarneeb.trump')} <strong>{SUIT_SYMBOL[hand.trumpSuit]}</strong>
        </p>
        <table className="tarneeb-handdone__table">
          <thead>
            <tr><th></th><th>{t('tarneeb.tricks')}</th><th>{t('tarneeb.hand')}</th><th>{t('tarneeb.score')}</th></tr>
          </thead>
          <tbody>
            {state.players.map((p) => (
              <tr key={p.id} className={p.seatIndex === hand.declarerSeat ? 'tarneeb-handdone__declarer' : ''}>
                <td>{nameOf(p.seatIndex)}</td>
                <td>{hand.tricksBySeat[p.seatIndex]}</td>
                <td>{fmt(hand.deltaBySeat[p.seatIndex])}</td>
                <td><strong>{scores[p.seatIndex]}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        {online ? (
          <p className="tarneeb-handdone__note">{t('tarneeb.nextHandSoon')}</p>
        ) : (
          <button type="button" className="btn btn--primary tarneeb-handdone__next" onClick={onNext} autoFocus>
            {t('tarneeb.nextHand')}
          </button>
        )}
      </div>
    </div>
  );
}
