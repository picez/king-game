// Solitaire guide player (S4): the real board on a small prepared position; the
// learner plays the highlighted move, then moves on. See src/solitaire/tutorials.ts.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { Move, PairMove, PileMove, SolitaireId, VariantKey } from '../../solitaire/engine';
import { engineFor } from '../../solitaire/registry';
import { tutorialFor } from '../../solitaire/tutorials';
import { tap, type Selection, type TapTarget } from '../../solitaire/tap';
import { solitaireInfo } from '../../solitaire/catalog';
import type { PileState } from '../../solitaire/pileKit';
import type { PyramidState } from '../../solitaire/pyramid';
import type { TriPeaksState } from '../../solitaire/triPeaks';
import PileBoard from './PileBoard';
import { PyramidBoard, TriPeaksBoard } from './PeakBoards';
import HeartsBoard from './HeartsBoard';
import type { HeartsState } from '../../solitaire/hearts';
import type { HeartsMove } from '../../solitaire/engine';

interface Props { id: SolitaireId; onExit: () => void; onPlay: (key: VariantKey) => void }

const same = (a: Move | null | undefined, b: Move | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

export default function SolitaireTutorial({ id, onExit, onPlay }: Props) {
  const { t } = useI18n();
  const guide = useMemo(() => tutorialFor(id), [id]);
  const info = solitaireInfo(id);
  const engine = engineFor(guide.key);
  const [i, setI] = useState(0);
  const [state, setState] = useState<unknown>(guide.steps[0].state);
  const [selection, setSelection] = useState<Selection>(null);
  const [solved, setSolved] = useState(false);
  const [wrong, setWrong] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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

  const step = guide.steps[i];
  const last = i === guide.steps.length - 1;
  const waiting = !!step.expect && !solved;

  function go(n: number) {
    setI(n);
    setState(guide.steps[n].state);
    setSelection(null);
    setSolved(false);
    setWrong(false);
  }

  function onTap(target: TapTarget) {
    if (!waiting) return;
    const r = tap(id, engine, state, selection, target);
    if (r.move && same(r.move, step.expect)) {
      setState(engine.apply(state, r.move));
      setSelection(null);
      setSolved(true);
      setWrong(false);
      return;
    }
    // The right card, picked for another place: keep it selected so the next tap chooses.
    const exp = step.expect;
    if (r.move && exp?.t === 'move' && r.move.t === 'move' && r.move.from === exp.from && r.move.n === exp.n) {
      setSelection({ kind: 'pile', pile: exp.from, n: exp.n });
      return;
    }
    setSelection(r.selection);
    if (!r.selection) setWrong(true);
  }

  const hint = waiting ? step.expect ?? null : null;
  const board = size.w > 0 && (id === 'hearts'
    ? <HeartsBoard state={state as HeartsState} hint={hint as HeartsMove | null} onTap={onTap} width={size.w} height={size.h} />
    : id === 'pyramid'
    ? <PyramidBoard state={state as PyramidState} selection={selection} hint={hint as PairMove | null} onTap={onTap} width={size.w} height={size.h} />
    : id === 'tripeaks'
      ? <TriPeaksBoard state={state as TriPeaksState} selection={selection} hint={hint as PairMove | null} onTap={onTap} width={size.w} height={size.h} />
      : <PileBoard variant={guide.key} state={state as PileState} selection={selection} hint={hint as PileMove | null} onTap={onTap} width={size.w} height={size.h} />);

  return (
    <div className="sol-screen sol-tutorial">
      <header className="sol-bar">
        <button type="button" className="btn btn--ghost btn--small" onClick={onExit} aria-label={t('sol.back')}>←</button>
        <div className="sol-bar__title"><span className="sol-bar__name">🎓 {info.icon} {t(`sol.${id}.title`)}</span></div>
        <span className="sol-bar__stat">{i + 1}/{guide.steps.length}</span>
      </header>
      <div className="sol-tutorial__caption" role="status" aria-live="polite">
        <p>{t(step.textKey)}</p>
        {waiting && <p className={wrong ? 'sol-tutorial__wrong' : 'sol-tutorial__try'}>{t(wrong ? 'solTut.wrong' : 'solTut.tryIt')}</p>}
        {solved && last && <p className="sol-tutorial__done">✓ {t('solTut.done')}</p>}
      </div>
      <div className="sol-table" ref={ref}>{board}</div>
      <nav className="sol-actions sol-actions--tutorial">
        <button type="button" className="btn btn--small" disabled={i === 0} onClick={() => go(i - 1)}>←</button>
        {!last && <button type="button" className="btn btn--primary btn--small" disabled={waiting} onClick={() => go(i + 1)}>{solved ? '✓ ' : ''}{t('solTut.next')}</button>}
        {last && <button type="button" className="btn btn--primary btn--small" disabled={waiting} onClick={() => onPlay(guide.key)}>{t('solTut.play')}</button>}
      </nav>
    </div>
  );
}
