// Hearts table (S5): three bots around a trick, your hand at the bottom.
// Pass phase: tap to choose three cards, then "Pass". Play: tap a legal card.

import { useState, type CSSProperties } from 'react';
import { useI18n } from '../../i18n';
import CardView from '../components/CardView';
import { toViewCard, type SCard } from '../../solitaire/cards';
import type { HeartsMove } from '../../solitaire/engine';
import { legalCards, passDirOf, type HeartsState, type TrickPlay } from '../../solitaire/hearts';
import type { TapTarget } from '../../solitaire/tap';
import { HIDDEN } from './PileBoard';

interface Props {
  state: HeartsState;
  hint: HeartsMove | null;
  onTap: (t: TapTarget) => void;
  /** Pass phase: the three chosen cards. */
  onPass?: (ids: number[]) => void;
  width: number;
  height: number;
}

const SEAT_KEYS = ['hearts.seat.you', 'hearts.seat.1', 'hearts.seat.2', 'hearts.seat.3'];

export default function HeartsBoard({ state, hint, onTap, onPass, width, height }: Props) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<number[]>([]);
  const hand = state.hands[0];
  const n = Math.max(hand.length, 1);
  // Hand card width: fit 13 overlapping cards (45 % visible each) into the width.
  const cw = Math.max(34, Math.min(78, Math.floor((width - 8) / (1 + (n - 1) * 0.5)), Math.floor(height / 5.2 / 1.59)));
  const ch = Math.round(cw * 1.59);
  const step = n > 1 ? Math.min(cw + 4, (width - 8 - cw) / (n - 1)) : 0;
  const tw = Math.max(34, Math.min(70, Math.floor(cw * 0.9)));
  const th = Math.round(tw * 1.59);

  const legal = new Set(legalCards(state, 0).map((c) => c.id));
  const myTurn = state.phase === 'play' && state.turn === 0;
  const passing = state.phase === 'pass';
  const hintIds = new Set(hint ? (hint.t === 'play' ? [hint.id] : hint.ids) : []);
  const received = new Set(state.trickNo === 0 ? state.received : []);

  function toggle(c: SCard) {
    setChosen((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : cur.length < 3 ? [...cur, c.id] : cur));
  }

  const shownTrick: TrickPlay[] = state.trick.length ? state.trick : state.lastTrick?.plays ?? [];
  const fadedTrick = state.trick.length === 0 && !!state.lastTrick;
  const spot: Record<number, CSSProperties> = {
    0: { left: '50%', bottom: 0, transform: 'translateX(-50%)' },
    1: { left: 0, top: '50%', transform: 'translateY(-50%)' },
    2: { left: '50%', top: 0, transform: 'translateX(-50%)' },
    3: { right: 0, top: '50%', transform: 'translateY(-50%)' },
  };

  const seat = (i: number) => (
    <div className={`hearts-seat hearts-seat--${i}${state.turn === i && state.phase === 'play' ? ' hearts-seat--turn' : ''}`}>
      <span className="hearts-seat__name">{t(SEAT_KEYS[i])}</span>
      <span className="hearts-seat__score">{state.scores[i]}{state.taken[i] ? ` (+${state.taken[i]})` : ''}</span>
      {i !== 0 && <span className="hearts-seat__cards" aria-hidden="true">🂠 {state.hands[i].length}</span>}
    </div>
  );

  let status = '';
  if (passing) status = t(`hearts.pass.${passDirOf(state.hand)}`);
  else if (fadedTrick && state.lastTrick) status = t('hearts.took').replace('{name}', t(SEAT_KEYS[state.lastTrick.winner]));
  else if (myTurn) status = t('hearts.yourTurn');

  return (
    <div className="hearts-board" style={{ width, height, '--sol-cw': `${cw}px`, '--sol-ch': `${ch}px`, '--h-tw': `${tw}px`, '--h-th': `${th}px` } as CSSProperties}>
      <div className="hearts-top">{seat(2)}</div>
      <div className="hearts-mid">
        {seat(1)}
        <div className={`hearts-trick${fadedTrick ? ' hearts-trick--last' : ''}`} style={{ width: tw * 3 + 12, height: th * 2 + 12 }}>
          {shownTrick.map((p) => (
            <div key={p.card.id} className="hearts-trick__card" style={spot[p.seat]}>
              <CardView card={toViewCard(p.card)} size="table" />
            </div>
          ))}
        </div>
        {seat(3)}
      </div>
      <div className="hearts-status" role="status" aria-live="polite">
        <span>{status}</span>
        {received.size > 0 && myTurn && <span className="hearts-status__sub">{t('hearts.received')}</span>}
        {passing && onPass && (
          <button type="button" className="btn btn--primary btn--small" disabled={chosen.length !== 3}
            onClick={() => { onPass(chosen); setChosen([]); }}>
            {t('hearts.passBtn').replace('{n}', String(chosen.length))}
          </button>
        )}
      </div>
      <div className="hearts-hand-row">
        {seat(0)}
        <div className="hearts-hand" style={{ width: step * (n - 1) + cw, height: ch + 14 }}>
          {hand.map((c, i) => {
            const isChosen = chosen.includes(c.id);
            const playable = passing || (myTurn && legal.has(c.id));
            return (
              <div key={c.id} className={`sol-slot hearts-hand__card${isChosen ? ' hearts-hand__card--up' : ''}`} style={{ left: Math.round(i * step), top: 14, zIndex: i + 1 }}>
                <CardView
                  card={c.up ? toViewCard(c) : (HIDDEN as never)}
                  size="table"
                  selected={isChosen}
                  highlight={hintIds.has(c.id) || received.has(c.id)}
                  dimmed={myTurn && !legal.has(c.id)}
                  onClick={playable ? () => (passing ? toggle(c) : onTap({ kind: 'card', id: c.id })) : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
