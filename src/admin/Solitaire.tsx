import { useState } from 'react';
import { api, del, fmtDate } from './adminApi';
import { useAction, useAdminData } from './useAdminData';
import { Pager } from './Users';
import { go } from './AdminApp';
import type { AdminSolitaireRow, AdminSolitaireSummary } from '../net/admin';
import { VARIANT_KEYS } from '../solitaire/engine';
import { formatClock } from '../ui/solitaire/format';

/** Ukrainian variant names (the admin is Ukrainian-only). */
export const VARIANT_LABEL: Record<string, string> = {
  'klondike-1': 'Косинка · по 1', 'klondike-3': 'Косинка · по 3', 'spider-1': 'Павук · 1 масть', 'spider-2': 'Павук · 2 масті',
  'spider-4': 'Павук · 4 масті', freecell: 'Солітер (FreeCell)', pyramid: 'Піраміда', tripeaks: 'Три вершини', yukon: 'Юкон', 'forty-thieves': 'Сорок розбійників', hearts: 'Черві',
};

interface Data { summary: AdminSolitaireSummary[]; rows: AdminSolitaireRow[]; total: number; pageSize: number }

/**
 * Solitaire section: verified wins per variant, the latest results and removal of
 * a suspicious one (logged with its reason). Every row was replayed by the server
 * from its seed before it was stored, so a row is a legal win; a removal is for an
 * implausible time (e.g. a solver) — the time is the server's own clock.
 */
export default function Solitaire() {
  const [variant, setVariant] = useState('');
  const [page, setPage] = useState(0);
  const data = useAdminData(() => api<Data>(`/solitaire?page=${page}${variant ? `&variant=${variant}` : ''}`), [page, variant]);
  const act = useAction();
  const d = data.data;

  async function remove(r: AdminSolitaireRow) {
    const reason = window.prompt(`Видалити результат ${r.user} (${VARIANT_LABEL[r.variant] ?? r.variant}, ${formatClock(r.ms)})?\nПричина:`, '');
    if (reason === null) return;
    if (await act.run(() => del(`/solitaire/${r.id}`, { reason }), 'Результат видалено.')) void data.reload();
  }

  return (
    <>
      <section className="adm-card">
        <h2>Пасьянси — зараховані перемоги</h2>
        <p className="adm-muted">Кожну перемогу сервер перевірив, програвши всі ходи з її роздачі. Час — від видачі роздачі до результату за годинником сервера.</p>
        {data.error && <p className="adm-err">{data.error}</p>}
        {d && d.summary.length === 0 && <p className="adm-muted">Ще немає жодної зарахованої перемоги.</p>}
        {d && d.summary.length > 0 && (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Пасьянс</th><th>Перемог</th><th>Гравців</th><th>Сьогодні</th><th>Рекорд</th></tr></thead>
              <tbody>
                {d.summary.map((s) => (
                  <tr key={s.variant}>
                    <td>{VARIANT_LABEL[s.variant] ?? s.variant}</td><td>{s.wins}</td><td>{s.players}</td><td>{s.today}</td>
                    <td>{s.bestMs !== null ? formatClock(s.bestMs) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="adm-card">
        <div className="adm-row adm-row--between">
          <h2>Останні результати{d ? ` (${d.total})` : ''}</h2>
          <select value={variant} onChange={(e) => { setVariant(e.target.value); setPage(0); }} aria-label="Пасьянс">
            <option value="">Усі пасьянси</option>
            {VARIANT_KEYS.map((k) => <option key={k} value={k}>{VARIANT_LABEL[k]}</option>)}
          </select>
        </div>
        {act.msg && <p className={act.msg.ok ? 'adm-ok' : 'adm-err'}>{act.msg.text}</p>}
        {d && (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Коли</th><th>Гравець</th><th>Пасьянс</th><th>Час</th><th>Ходи</th><th>Назад / підказки</th><th /></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.at)}</td>
                    <td><a href={`#/users/${r.userId}`} onClick={(e) => { e.preventDefault(); go('users', r.userId); }}>{r.user}</a></td>
                    <td>{VARIANT_LABEL[r.variant] ?? r.variant}{r.daily ? ` · 📅 ${r.daily}` : ''}</td>
                    <td>{formatClock(r.ms)}</td><td>{r.moves}</td><td>{r.undos} / {r.hints}</td>
                    <td><button type="button" className="adm-btn adm-btn--danger" disabled={act.busy} onClick={() => void remove(r)}>Видалити</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && <Pager page={page} pages={Math.max(1, Math.ceil(d.total / d.pageSize))} onPage={setPage} />}
      </section>
    </>
  );
}
