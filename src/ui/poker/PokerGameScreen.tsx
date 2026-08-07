import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { legalActions, smallBlindSeat, bigBlindSeat } from '../../games/poker/rules';
import type { PokerAction, PokerState } from '../../games/poker/types';
import PokerCardView from './PokerCardView';
import PokerHandRankings from './PokerHandRankings';
import PokerShowdownReview from './PokerShowdownReview';
import { seatPosition } from './pokerSeatLayout';
import { clampAmount, commitAmount, parseAmountInput, syncAmountToRange, wagerKindFor, type BetRange } from './betAmount';

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
  /**
   * Social / utility controls rendered IN NORMAL FLOW between the table and the action
   * row (Stage 38.0.3). The owner FAIL was a FIXED corner cluster landing on top of the
   * bet/call/raise controls on a phone; giving those controls their own layout row here
   * makes the overlap structurally impossible. Game-agnostic node — the caller decides
   * what goes in it (online: RoomSocial docked; local: the action-history control).
   */
  socialSlot?: ReactNode;
  /** The between-hands rebuy panel (§17), rendered under the hand review so the showdown
   *  result stays on screen while the busted seats decide. */
  rebuySlot?: ReactNode;
  /**
   * (38.0.8, ONLINE BANKROLL ONLY) Whether this paid match counts towards Poker stats.
   * `undefined` for LOCAL free Poker and for any table with no policy decision — the badge
   * is then not rendered at all, so local play looks exactly as before.
   */
  statsEligible?: boolean;
  /** (38.0.8) Rebuys this viewer's seat may still take, or `undefined` when uncapped. */
  rebuysLeft?: number;
}

/**
 * The shared poker table (local + online) — an oval felt with 2–6 seats positioned
 * around it (§16 F). The viewer always sits at the bottom; the board, pot and street
 * live in the centre; opponents show card backs; a showdown review overlays the
 * authoritative result. Geometry is physical (stable under RTL) and the action row is
 * mobile-safe. A Help button opens the hand-rankings modal.
 *
 * Stage 38.0.2: the action history is NO LONGER rendered here. It is a compact
 * `PokerActionLog` control owned by the caller — RoomSocial's `utilitySlot` online,
 * a matching bottom-end cluster locally — so exactly one log control exists per table.
 */
export default function PokerGameScreen({
  state, mySeat, apply, onExit, online, readOnly, socialSlot, rebuySlot, statsEligible, rebuysLeft,
}: Props) {
  const { t } = useI18n();
  const pot = state.contributedBySeat.reduce((a, b) => a + b, 0);
  const myTurn = state.phase === 'betting' && mySeat != null && state.toActSeat === mySeat && !readOnly;
  const la = useMemo(() => (myTurn ? legalActions(state, mySeat!) : null), [state, myTurn, mySeat]);
  const sb = smallBlindSeat(state);
  const bb = bigBlindSeat(state);
  const [showHelp, setShowHelp] = useState(false);
  // The hand review stays up through the rebuy window (§17) so the showdown that
  // busted someone is still readable while they decide.
  const inReview = state.phase === 'hand_complete' || state.phase === 'rebuy_window';

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

      {/* (38.0.8) Anti-dumping status — ONLINE BANKROLL ONLY. It states WHAT is true for this
          table (counts / does not count, rebuys left) and never why, never a threshold and
          never anything about another player. Absent entirely in LOCAL free Poker. */}
      {(statsEligible !== undefined || rebuysLeft !== undefined) && (
        <div className="poker-policy-bar">
          {statsEligible !== undefined && (
            <span className={`poker-policy-badge ${statsEligible ? 'poker-policy-badge--ranked' : 'poker-policy-badge--unranked'}`}>
              {statsEligible ? t('poker.ranked') : t('poker.unranked')}
            </span>
          )}
          {rebuysLeft !== undefined && (
            <span className="poker-policy-rebuys">{t('poker.rebuysLeft').replace('{n}', String(rebuysLeft))}</span>
          )}
        </div>
      )}

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
        <PokerShowdownReview
          state={state} mySeat={mySeat}
          onNext={(online || readOnly || state.phase === 'rebuy_window')
            ? undefined
            : () => apply({ type: 'START_NEXT_HAND' })}
        />
      )}

      {/* Between-hands rebuy (§17) — under the review, above the social/action rows. */}
      {rebuySlot}

      {/* Social / utility toolbar — IN FLOW, so it can never cover the controls below. */}
      {socialSlot && <div className="poker-social-dock">{socialSlot}</div>}

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

/**
 * The mobile-safe bet/raise controls: min / half-pot / pot / all-in presets, a slider
 * AND a manual numeric field (Stage 38.0.2) — all three driving ONE amount through the
 * pure `betAmount` helpers, so they can never disagree.
 *
 * The field may be blank WHILE editing (so a value can be retyped), but a commit
 * (blur, Enter, or the Bet/Raise button) always runs strict finite/safe-integer
 * validation and clamps into [raiseMin, maxTo] — an unusable draft falls back to the
 * last valid amount, so no illegal action is ever dispatched. Enter in the field fires
 * exactly the same action as the button. Reaching `maxTo` sends ALL_IN as before.
 */
function PokerActions({ la, pot, apply }: { la: ReturnType<typeof legalActions>; pot: number; apply: (a: PokerAction) => void }) {
  const { t } = useI18n();
  const raiseMin = la.canBet ? la.minBet : la.minRaiseTo;
  const range = useMemo<BetRange>(() => ({ min: raiseMin, max: la.maxTo }), [raiseMin, la.maxTo]);
  const [amount, setAmount] = useState<number>(() => clampAmount(raiseMin, { min: raiseMin, max: la.maxTo }));
  /** The text in the numeric field. Kept in sync with `amount`; may be blank mid-edit. */
  const [draft, setDraft] = useState<string>(() => String(clampAmount(raiseMin, { min: raiseMin, max: la.maxTo })));
  const canWager = la.canBet || la.canRaise;

  // The legal window can change under us (new street / new actor / short stack):
  // re-clamp the held amount into the NEW range instead of keeping a stale one.
  useEffect(() => {
    setAmount((prev) => {
      const next = syncAmountToRange(prev, range);
      if (next !== prev) setDraft(String(next));
      return next;
    });
  }, [range]);

  /** Set both controls from a known-good numeric value (slider + presets). */
  const setBoth = (v: number) => { const c = clampAmount(v, range); setAmount(c); setDraft(String(c)); };

  const presets: [string, number][] = [
    [t('poker.preset.min'), raiseMin],
    [t('poker.preset.half'), clampAmount(raiseMin + Math.round(pot * 0.5), range)],
    [t('poker.preset.pot'), clampAmount(raiseMin + pot, range)],
    [t('poker.allIn'), la.maxTo],
  ];

  /** Commit whatever is in the field, then dispatch. Returns the committed amount. */
  const sendWager = () => {
    const v = commitAmount(draft, amount, range);
    setAmount(v); setDraft(String(v));
    const kind = wagerKindFor(v, range, la.canBet);
    if (kind === 'ALL_IN') apply({ type: 'ALL_IN' });
    else if (kind === 'BET') apply({ type: 'BET', amount: v });
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
              <button key={label} type="button" className="btn btn--ghost poker-preset" onClick={() => setBoth(v)}>{label}</button>
            ))}
          </div>
          <div className="poker-amount-row">
            <input
              className="input poker-amount-input"
              type="number"
              inputMode="numeric"
              step={1}
              min={range.min}
              max={range.max}
              value={draft}
              aria-label={t('poker.amount')}
              onChange={(e) => {
                const raw = e.target.value;
                setDraft(raw);
                // Live-sync the slider only for a parseable value; a blank/partial/invalid
                // draft simply leaves the last valid amount in place (nothing jumps).
                const parsed = parseAmountInput(raw);
                if (parsed != null) setAmount(clampAmount(parsed, range));
              }}
              onBlur={() => setBoth(commitAmount(draft, amount, range))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendWager(); } }}
            />
            <span className="poker-amount-range">
              {t('poker.amountRange').replace('{min}', String(range.min)).replace('{max}', String(range.max))}
            </span>
          </div>
          <input
            className="poker-slider"
            type="range"
            min={range.min}
            max={range.max}
            value={clampAmount(amount, range)}
            onChange={(e) => setBoth(Number(e.target.value))}
            aria-label={t('poker.amount')}
          />
          <button type="button" className="btn btn--primary poker-wager-go" onClick={sendWager}>
            {la.canBet ? t('poker.bet') : t('poker.raiseTo')} {clampAmount(amount, range)}
          </button>
        </div>
      )}
    </div>
  );
}
