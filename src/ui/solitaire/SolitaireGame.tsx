// Solitaire game screen (S2): top bar (back · title · clock · moves), the board,
// the action bar (undo · hint · restart · new · auto-finish) and the win card.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { infoOfVariant } from '../../solitaire/catalog';
import type { Move, PairMove, PileMove } from '../../solitaire/engine';
import { engineFor } from '../../solitaire/registry';
import { autoFinish, current, hint as hintOf, play, restart, started, tick, undo, type Session } from '../../solitaire/session';
import { variantStats, type SolitaireStats } from '../../solitaire/stats';
import { tap, type Selection, type TapTarget } from '../../solitaire/tap';
import type { PileState } from '../../solitaire/pileKit';
import type { PyramidState } from '../../solitaire/pyramid';
import type { TriPeaksState } from '../../solitaire/triPeaks';
import PileBoard from './PileBoard';
import { PyramidBoard, TriPeaksBoard } from './PeakBoards';
import { formatClock } from './format';
import { labelOf } from './SolitaireHub';
import type { RankedOutcome } from '../../net/solitaireApi';
import type { Achievement } from '../../stats/achievements';

interface Props {
  session: Session;
  stats: SolitaireStats;
  /** The server's verdict on a won game (S3). */
  ranked: RankedOutcome | 'pending' | null;
  /** Solitaire achievements this win unlocked. */
  badges?: Achievement[];
  onChange: (s: Session) => void;
  onNewDeal: () => void;
  onExit: () => void;
}

function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export default function SolitaireGame({ session, stats, ranked, badges = [], onChange, onNewDeal, onExit }: Props) {
  const { t } = useI18n();
  const info = infoOfVariant(session.key);
  const engine = engineFor(session.key);
  const state = current(session);
  const [selection, setSelection] = useState<Selection>(null);
  const [hint, setHint] = useState<Move | null>(null);
  const [shake, setShake] = useState(false);
  const box = useBoxSize<HTMLDivElement>();
  const latest = useRef(session);
  latest.current = session;

  // Clock: counts only while the page is visible, the game started and not won.
  useEffect(() => {
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const ms = now - last;
      last = now;
      if (document.visibilityState !== 'visible') return;
      const s = latest.current;
      if (!started(s) || s.finished) return;
      onChange(tick(s, Math.min(ms, 5000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [onChange]);

  // "Nothing to do there" wobble.
  useEffect(() => {
    if (!shake) return;
    const id = window.setTimeout(() => setShake(false), 320);
    return () => window.clearTimeout(id);
  }, [shake]);

  // A hint shows for 1.6 s.
  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(null), 1600);
    return () => window.clearTimeout(id);
  }, [hint]);

  function commit(m: Move) {
    const next = play(session, m);
    if (next !== session) { setHint(null); onChange(next); }
  }

  function onTap(target: TapTarget) {
    if (session.finished) return;
    const r = tap(info.id, engine, state, selection, target);
    setSelection(r.selection);
    if (r.move) commit(r.move);
    else if (!r.selection && target.kind !== 'stock') setShake(true);
  }

  const won = session.finished === 'won';
  const canFinish = !won && engine.canAutoFinish(state);
  const stuck = !won && engine.legal(state).length === 0;
  const best = variantStats(stats, session.key);

  return (
    <div className="sol-screen">
      <header className="sol-bar">
        <button type="button" className="btn btn--ghost btn--small" onClick={onExit} aria-label={t('sol.back')}>←</button>
        <div className="sol-bar__title">
          <span className="sol-bar__name">{info.icon} {labelOf(t, session.key)}</span>
          {session.daily && <span className="sol-bar__daily">📅 {t('sol.daily')} · {session.daily}</span>}
        </div>
        <span className="sol-bar__stat" aria-label={t('sol.time')}>⏱ {formatClock(session.elapsedMs)}</span>
        <span className="sol-bar__stat" aria-label={t('sol.moves')}>↔ {session.moves.length}</span>
      </header>

      <div className={`sol-table${shake ? ' sol-table--shake' : ''}`} ref={box.ref}>
        {box.w > 0 && (info.id === 'pyramid'
          ? <PyramidBoard state={state as PyramidState} selection={selection} hint={hint as PairMove | null} onTap={onTap} width={box.w} height={box.h} />
          : info.id === 'tripeaks'
            ? <TriPeaksBoard state={state as TriPeaksState} selection={selection} hint={hint as PairMove | null} onTap={onTap} width={box.w} height={box.h} />
            : <PileBoard variant={session.key} state={state as PileState} selection={selection} hint={hint as PileMove | null} onTap={onTap} width={box.w} height={box.h} />)}
      </div>

      {stuck && <p className="sol-note" role="status">{t('sol.stuck')}</p>}

      <nav className="sol-actions" aria-label={t('sol.actions')}>
        <button type="button" className="btn btn--small" disabled={!session.moves.length || won}
          onClick={() => { setSelection(null); onChange(undo(session)); }}><span className="sol-act__icon" aria-hidden="true">↶</span><span className="sol-act__label">{t('sol.undo')}</span></button>
        <button type="button" className="btn btn--small" disabled={won}
          onClick={() => { const h = hintOf(session); setSelection(null); setHint(h.move); if (h.move) onChange(h.session); else setShake(true); }}><span className="sol-act__icon" aria-hidden="true">💡</span><span className="sol-act__label">{t('sol.hint')}</span></button>
        {canFinish
          ? <button type="button" className="btn btn--primary btn--small" onClick={() => onChange(autoFinish(session))}><span className="sol-act__icon" aria-hidden="true">⚡</span><span className="sol-act__label">{t('sol.finish')}</span></button>
          : <button type="button" className="btn btn--small" disabled={!session.moves.length || won}
            onClick={() => { setSelection(null); onChange(restart(session)); }}><span className="sol-act__icon" aria-hidden="true">⟲</span><span className="sol-act__label">{t('sol.restart')}</span></button>}
        <button type="button" className="btn btn--small" onClick={onNewDeal}><span className="sol-act__icon" aria-hidden="true">🂠</span><span className="sol-act__label">{t('sol.new')}</span></button>
      </nav>

      {won && (
        <div className="sol-modal" role="dialog" aria-modal="true" aria-label={t('sol.won')}>
          <div className="sol-modal__box sol-win">
            <div className="sol-win__burst" aria-hidden="true">🎉</div>
            <h3>{t('sol.won')}</h3>
            <p className="sol-win__line">⏱ {formatClock(session.elapsedMs)} · ↔ {session.moves.length}</p>
            <p className="sol-win__ranked" role="status">
              {ranked === 'pending' ? t('sol.ranked.pending')
                : ranked?.kind === 'ranked' ? t(ranked.board === 'daily' ? 'sol.ranked.daily' : 'sol.ranked.ok').replace('{rank}', String(ranked.rank ?? '—')).replace('{time}', formatClock(ranked.ms))
                  : ranked?.kind === 'error' ? t('sol.ranked.error')
                    : t('sol.ranked.local')}
            </p>
            {best.bestMs !== null && <p className="sol-win__best">{t('sol.best')}: {formatClock(best.bestMs)} · {t('sol.streak')}: {best.streak}</p>}
            {badges.length > 0 && (
              <div className="sol-win__badges">
                <p className="sol-win__badges-title">🏆 {t('sol.newBadges')}</p>
                {badges.map((a) => (
                  <p key={a.id} className="sol-win__badge"><span aria-hidden="true">{a.icon}</span> <b>{t(a.titleKey)}</b> — {t(a.descriptionKey)}</p>
                ))}
              </div>
            )}
            <div className="sol-win__actions">
              <button type="button" className="btn btn--primary" onClick={onNewDeal}>{t('sol.newDeal')}</button>
              <button type="button" className="btn btn--ghost" onClick={onExit}>{t('sol.toHub')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
