import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { legalActions, smallBlindSeat, bigBlindSeat } from '../../games/poker/rules';
import type { HandCategory, PokerAction, PokerState } from '../../games/poker/types';
import PokerCardView from './PokerCardView';

interface Props {
  state: PokerState;
  /** The viewer's seat (local: the human; online: this client's seat), or null for a spectator. */
  mySeat: number | null;
  apply: (action: PokerAction) => void;
  onExit: () => void;
  /** Online rooms auto-advance between hands on the server; local waits for a tap. */
  online?: boolean;
}

const CATEGORY_KEY: Record<HandCategory, string> = {
  high_card: 'poker.cat.highCard', one_pair: 'poker.cat.onePair', two_pair: 'poker.cat.twoPair',
  three_of_a_kind: 'poker.cat.trips', straight: 'poker.cat.straight', flush: 'poker.cat.flush',
  full_house: 'poker.cat.fullHouse', four_of_a_kind: 'poker.cat.quads',
  straight_flush: 'poker.cat.straightFlush', royal_flush: 'poker.cat.royalFlush',
};

/**
 * The shared poker table (local + online). Renders the board, pot, every seat with
 * its stack/bet/status, the viewer's hole cards, and the mobile-safe action row when
 * it is the viewer's turn. Read-only when it is not this viewer's turn. Layout is
 * stable across streets (the board always reserves five slots) and RTL-safe.
 */
export default function PokerGameScreen({ state, mySeat, apply, onExit, online }: Props) {
  const { t } = useI18n();
  const pot = state.contributedBySeat.reduce((a, b) => a + b, 0);
  const myTurn = state.phase === 'betting' && mySeat != null && state.toActSeat === mySeat;
  const la = useMemo(() => (myTurn ? legalActions(state, mySeat!) : null), [state, myTurn, mySeat]);
  const sb = smallBlindSeat(state);
  const bb = bigBlindSeat(state);

  return (
    <div className="screen poker-screen">
      <header className="poker-topbar">
        <button type="button" className="poker-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className="poker-hand-no">{t('poker.hand')} #{state.handNumber}</span>
        <span className="poker-pot" aria-label={t('poker.pot')}>💰 {pot}</span>
      </header>

      {/* Community board — always five slots so the table never reflows (§14). */}
      <div className="poker-board" role="group" aria-label={t('poker.board')}>
        {Array.from({ length: 5 }).map((_, i) => {
          const card = state.board[i];
          return card
            ? <PokerCardView key={card.id} card={card} />
            : <div key={`slot-${i}`} className="poker-card poker-card--empty" aria-hidden="true" />;
        })}
      </div>
      <div className="poker-street-label">{t(`poker.street.${state.street}`)}</div>

      {/* Seats */}
      <ul className="poker-seats">
        {state.players.map((p) => {
          const seat = p.seatIndex;
          const out = state.eliminatedBySeat[seat];
          const folded = state.foldedBySeat[seat];
          const isMe = seat === mySeat;
          const acting = state.phase === 'betting' && state.toActSeat === seat;
          const hole = state.holeCardsBySeat[seat] ?? [];
          return (
            <li key={p.id} className={`poker-seat${acting ? ' poker-seat--acting' : ''}${folded ? ' poker-seat--folded' : ''}${out ? ' poker-seat--out' : ''}`}>
              <div className="poker-seat__head">
                <span className="poker-seat__name">{isMe ? t('poker.you') : p.name}</span>
                <span className="poker-seat__badges">
                  {seat === state.buttonSeat && <span className="poker-badge poker-badge--btn" title={t('poker.button')}>D</span>}
                  {seat === sb && <span className="poker-badge">SB</span>}
                  {seat === bb && <span className="poker-badge">BB</span>}
                  {state.allInBySeat[seat] && <span className="poker-badge poker-badge--allin">{t('poker.allInShort')}</span>}
                </span>
              </div>
              <div className="poker-seat__row">
                <span className="poker-seat__stack">🪙 {state.stacksBySeat[seat]}</span>
                {state.committedBySeat[seat] > 0 && <span className="poker-seat__bet">{t('poker.bet')} {state.committedBySeat[seat]}</span>}
                {folded && <span className="poker-seat__tag">{t('poker.folded')}</span>}
                {out && <span className="poker-seat__tag">{t('poker.out')}</span>}
              </div>
              <div className="poker-seat__cards">
                {hole.map((c, i) => <PokerCardView key={c.id === 'hidden' ? `h-${seat}-${i}` : c.id} card={c} size="sm" />)}
                {state.lastHand?.categoryBySeat[seat] != null && (
                  <span className="poker-seat__cat">{t(CATEGORY_KEY[state.lastHand.categoryBySeat[seat]])}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Hand result / next-hand (local only — online advances on the server) */}
      {state.phase === 'hand_complete' && (
        <div className="poker-result">
          <p className="poker-result__text">
            {state.lastHand?.showdown ? t('poker.showdown') : t('poker.wonByFold')}
          </p>
          {!online && (
            <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'START_NEXT_HAND' })}>
              {t('poker.nextHand')}
            </button>
          )}
        </div>
      )}

      {/* Action row (mobile-safe, wraps) */}
      {myTurn && la && <PokerActions la={la} pot={pot} apply={apply} />}
      {state.phase === 'betting' && !myTurn && (
        <p className="poker-waiting">{t('poker.waiting').replace('{name}', state.players[state.toActSeat]?.name ?? '')}</p>
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
