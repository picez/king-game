// Solitaire leaderboards (S3): per variant — best time, fewest moves, most wins
// and today's deal of the day. Server-verified results only.

import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { SOLITAIRES } from '../../solitaire/catalog';
import { VARIANT_KEYS, type VariantKey } from '../../solitaire/engine';
import { LEADER_BOARDS, type LeaderBoard, type LeaderboardResponse, type LeaderRow } from '../../solitaire/ranked';
import { fetchSolitaireLeaderboard } from '../../net/solitaireApi';
import SelectMenu from '../components/SelectMenu';
import { formatClock } from './format';
import { labelOf } from './SolitaireHub';

export default function SolitaireLeaderboard() {
  const { t } = useI18n();
  const [variant, setVariant] = useState<VariantKey>('klondike-1');
  const [board, setBoard] = useState<LeaderBoard>('time');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    void fetchSolitaireLeaderboard(variant, board).then((r) => {
      if (!live) return;
      setData(r);
      setState(r ? 'ok' : 'error');
    });
    return () => { live = false; };
  }, [variant, board]);

  const value = (r: LeaderRow) => (board === 'wins' ? String(r.value) : board === 'moves' ? String(r.value) : formatClock(r.value));
  const extra = (r: LeaderRow) => (board === 'moves' ? (r.ms !== null ? formatClock(r.ms) : '') : board === 'wins' ? '' : r.moves !== null ? String(r.moves) : '');
  const ordered = SOLITAIRES.flatMap((s) => s.variants.map((v) => v.key)).filter((k) => VARIANT_KEYS.includes(k));

  return (
    <section className="sol-lb">
      <div className="sol-lb__filters">
        <SelectMenu ariaLabel={t('sol.lb.variant')} value={variant} onChange={(v) => setVariant(v as VariantKey)}
          options={ordered.map((k) => ({ value: k, label: labelOf(t, k) }))} />
        <div className="sol-chips" role="radiogroup" aria-label={t('sol.lb.board')}>
          {LEADER_BOARDS.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={board === b} className={`sol-chip${board === b ? ' sol-chip--on' : ''}`} onClick={() => setBoard(b)}>
              {t(`sol.lb.${b}`)}
            </button>
          ))}
        </div>
      </div>
      {state === 'loading' && <p className="sol-lb__empty">{t('sol.lb.loading')}</p>}
      {state === 'error' && <p className="sol-lb__empty">{t('sol.lb.offline')}</p>}
      {state === 'ok' && data && data.rows.length === 0 && <p className="sol-lb__empty">{t('sol.lb.empty')}</p>}
      {state === 'ok' && data && data.rows.length > 0 && (
        <table className="sol-lb__table">
          <thead>
            <tr>
              <th>#</th><th>{t('sol.lb.player')}</th>
              <th>{t(`sol.lb.col.${board}`)}</th>
              {board !== 'wins' && <th>{board === 'moves' ? t('sol.time') : t('sol.moves')}</th>}
            </tr>
          </thead>
          <tbody>
            {[...data.rows, ...(data.me && !data.rows.some((r) => r.self) ? [data.me] : [])].map((r) => (
              <tr key={`${r.rank}-${r.displayName}`} className={r.self ? 'sol-lb__me' : undefined}>
                <td>{r.rank}</td>
                <td className="sol-lb__name">{r.displayName}</td>
                <td>{value(r)}</td>
                {board !== 'wins' && <td>{extra(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="sol-lb__empty">{t('sol.lb.note')}</p>
    </section>
  );
}
