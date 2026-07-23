import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { legalActions, smallBlindSeat, bigBlindSeat } from '../../games/poker/rules';
import type { PokerActionKind, PokerAction, PokerState } from '../../games/poker/types';
import PokerCardView from './PokerCardView';
import PokerHandRankings from './PokerHandRankings';
import PokerShowdownReview from './PokerShowdownReview';
import { seatPosition } from './pokerSeatLayout';

interface Props {
  state: PokerState;
  /** The viewer's seat (local: the human; online: this client's seat), or null for a spectator. */
  mySeat: number | null;
  apply: (action: PokerAction) => void;
  onExit: () => void;
  /** Online rooms auto-advance between hands on the server; local waits for a tap. */
  online?: boolean;
  /** Stage 37.7.6 (FAIL 2): a frozen / settlement-pending bankroll table is fully READ-ONLY —
   *  no bet/fold/check/call/raise/all-in controls and no manual next-hand. */
  readOnly?: boolean;
}

/** i18n label per action-log kind (reuses the action labels; blind/raise are log-only). */
const LOG_KIND_KEY: Record<PokerActionKind, string> = {
  blind: 'poker.log.blind', fold: 'poker.fold', check: 'poker.check', call: 'poker.call',
  bet: 'poker.bet', raise: 'poker.log.raise', allin: 'poker.allIn',
};

/**
 * The shared poker table (local + online) — an oval felt with 2–6 seats positioned
 * around it (§16 F). The viewer always sits at the bottom; the board, pot and street
 * live in the centre; opponents show card backs; a showdown review overlays the
 * authoritative result. Geometry is physical (stable under RTL), the action row is
 * mobile-safe, and the action log is collapsible (default closed). A Help button opens
 * the hand-rankings modal.
 */
export default function PokerGameScreen({ state, mySeat, apply, onExit, online, readOnly }: Props) {
  const { t } = useI18n();
  const pot = state.contributedBySeat.reduce((a, b) => a + b, 0);
  const myTurn = state.phase === 'betting' && mySeat != null && state.toActSeat === mySeat && !readOnly;
  const la = useMemo(() => (myTurn ? legalActions(state, mySeat!) : null), [state, myTurn, mySeat]);
  const sb = smallBlindSeat(state);
  const bb = bigBlindSeat(state);
  const [showHelp, setShowHelp] = useState(false);
  const inReview = state.phase === 'hand_complete';

  return (
    <div className="screen poker-screen">
      {showHelp && <PokerHandRankings onClose={() => setShowHelp(false)} />}

      <header className="poker-topbar">
        <button type="button" className="poker-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className="poker-topbar__meta">
          <span className="poker-hand-no">{t('poker.hand')} #{state.handNumber}</span>
          <span className="poker-blinds-now">🔺 {state.smallBlindCurrent}/{state.bigBlindCurrent}</span>
        </span>
        <button type="button" className="poker-help-btn" onClick={() => setShowHelp(true)} aria-label={t('poker.help.title')}>❓</button>
      </header>

      {/* Oval felt table with the seats positioned around it. */}
      <div className="poker-table-wrap">
        <div className="poker-table">
          <div className="poker-center">
            <div className="poker-board" role="group" aria-label={t('poker.board')}>
              {Array.from({ length: 5 }).map((_, i) => {
                const card = state.board[i];
                return card
                  ? <PokerCardView key={card.id} card={card} />
                  : <div key={`slot-${i}`} className="poker-card poker-card--empty" aria-hidden="true" />;
              })}
            </div>
            <div className="poker-center__info">
              <span className="poker-pot" aria-label={t('poker.pot')}>💰 {pot}</span>
              <span className="poker-street-label">{t(`poker.street.${state.street}`)}</span>
            </div>
          </div>

          {state.players.map((p) => {
            const seat = p.seatIndex;
            const pos = seatPosition(seat, mySeat, state.playerCount);
            const out = state.eliminatedBySeat[seat];
            const folded = state.foldedBySeat[seat];
            const isMe = seat === mySeat;
            const acting = state.phase === 'betting' && state.toActSeat === seat;
            const hole = state.holeCardsBySeat[seat] ?? [];
            const cls = `poker-pod${acting ? ' poker-pod--acting' : ''}${folded ? ' poker-pod--folded' : ''}${out ? ' poker-pod--out' : ''}${isMe ? ' poker-pod--me' : ''}`;
            return (
              <div key={p.id} className={cls} style={{ left: `${pos.left}%`, top: `${pos.top}%` }}>
                <div className="poker-pod__badges">
                  {seat === state.buttonSeat && <span className="poker-badge poker-badge--btn" title={t('poker.button')}>D</span>}
                  {seat === sb && <span className="poker-badge">SB</span>}
                  {seat === bb && <span className="poker-badge">BB</span>}
                  {state.allInBySeat[seat] && <span className="poker-badge poker-badge--allin">{t('poker.allInShort')}</span>}
                </div>
                <div className="poker-pod__cards">
                  {hole.map((c, i) => <PokerCardView key={c.id === 'hidden' ? `h-${seat}-${i}` : c.id} card={c} size="sm" />)}
                </div>
                <span className="poker-pod__name">{isMe ? t('poker.you') : p.name}</span>
                <span className="poker-pod__stack">🪙 {state.stacksBySeat[seat]}</span>
                {folded && <span className="poker-pod__tag">{t('poker.folded')}</span>}
                {out && <span className="poker-pod__tag">{t('poker.out')}</span>}
                {state.committedBySeat[seat] > 0 && !out && (
                  <span className="poker-pod__bet">{state.committedBySeat[seat]}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Showdown / fold-win review (§16 G). Local shows a Next button; online is
          server-paced (auto-advances) so the overlay is display-only. */}
      {inReview && (
        <PokerShowdownReview state={state} mySeat={mySeat} onNext={(online || readOnly) ? undefined : () => apply({ type: 'START_NEXT_HAND' })} />
      )}

      {/* Collapsible public action log (§16 I) — default closed, with an unread dot. */}
      <PokerLog state={state} />

      {/* (37.7.6 FAIL 2) A frozen / settlement-pending table is READ-ONLY: no action controls. */}
      {readOnly ? (
        <p className="poker-waiting poker-waiting--paused">⏸️ {t('poker.recovery.frozenShort')}</p>
      ) : (
        <>
          {myTurn && la && <PokerActions la={la} pot={pot} apply={apply} />}
          {state.phase === 'betting' && !myTurn && (
            <p className="poker-waiting">{t('poker.waiting').replace('{name}', state.players[state.toActSeat]?.name ?? '')}</p>
          )}
        </>
      )}
    </div>
  );
}

/** Collapsible public log of the current hand's actions (§16 I). Default CLOSED; shows
 *  an unread dot when new actions arrive while closed. No card/deck/burn/user data. */
function PokerLog({ state }: { state: PokerState }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const log = state.actionLog ?? [];
  const seenRef = useRef(0);
  const unread = !open && log.length > seenRef.current;
  useEffect(() => { if (open) seenRef.current = log.length; }, [open, log.length]);

  const rows = log.slice(-30);
  return (
    <div className="poker-logbox">
      <button
        type="button"
        className={`poker-log-toggle ${unread ? 'has-unread' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} {t('poker.log.title')}
        {unread && <span className="poker-log-dot" aria-label={t('poker.log.new')} />}
      </button>
      {open && (
        log.length === 0
          ? <p className="poker-log__empty">—</p>
          : (
            <ol className="poker-log__list">
              {rows.map((e, i) => (
                <li key={log.length - rows.length + i} className="poker-log__row">
                  <span className="poker-log__name">{state.players[e.seat]?.name ?? `#${e.seat + 1}`}</span>
                  <span className="poker-log__act">{t(LOG_KIND_KEY[e.kind])}{e.amount > 0 ? ` ${e.amount}` : ''}</span>
                </li>
              ))}
            </ol>
          )
      )}
    </div>
  );
}

/** The mobile-safe bet/raise controls with min / half-pot / pot / all-in presets (§14). */
function PokerActions({ la, pot, apply }: { la: ReturnType<typeof legalActions>; pot: number; apply: (a: PokerAction) => void }) {
  const { t } = useI18n();
  const raiseMin = la.canBet ? la.minBet : la.minRaiseTo;
  const [amount, setAmount] = useState<number>(raiseMin);
  const canWager = la.canBet || la.canRaise;

  const clamp = (v: number) => Math.max(raiseMin, Math.min(la.maxTo, v));
  const presets: [string, number][] = [
    [t('poker.preset.min'), raiseMin],
    [t('poker.preset.half'), clamp(raiseMin + Math.round(pot * 0.5))],
    [t('poker.preset.pot'), clamp(raiseMin + pot)],
    [t('poker.allIn'), la.maxTo],
  ];

  const sendWager = () => {
    const v = clamp(amount);
    if (v >= la.maxTo) apply({ type: 'ALL_IN' });
    else if (la.canBet) apply({ type: 'BET', amount: v });
    else apply({ type: 'RAISE', amount: v });
  };

  return (
    <div className="poker-actions">
      <div className="poker-actions__primary">
        {la.canFold && <button type="button" className="btn btn--ghost" onClick={() => apply({ type: 'FOLD' })}>{t('poker.fold')}</button>}
        {la.canCheck && <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'CHECK' })}>{t('poker.check')}</button>}
        {la.canCall && <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'CALL' })}>{t('poker.call')} {la.callAmount}</button>}
      </div>
      {canWager && (
        <div className="poker-actions__wager">
          <div className="poker-presets">
            {presets.map(([label, v]) => (
              <button key={label} type="button" className="btn btn--ghost poker-preset" onClick={() => setAmount(v)}>{label}</button>
            ))}
          </div>
          <input
            className="poker-slider"
            type="range"
            min={raiseMin}
            max={la.maxTo}
            value={clamp(amount)}
            onChange={(e) => setAmount(Number(e.target.value))}
            aria-label={t('poker.amount')}
          />
          <button type="button" className="btn btn--primary poker-wager-go" onClick={sendWager}>
            {la.canBet ? t('poker.bet') : t('poker.raiseTo')} {clamp(amount)}
          </button>
        </div>
      )}
    </div>
  );
}
