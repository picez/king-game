import { useState } from 'react';
import { api, fmtDate, fmtDay } from './adminApi';
import { useAdminData } from './useAdminData';
import { go } from './AdminApp';
import type { AdminUserRow } from '../net/admin';

type Filter = 'all' | 'accounts' | 'guests' | 'banned';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Усі' }, { id: 'accounts', label: 'Акаунти' }, { id: 'guests', label: 'Гості' }, { id: 'banned', label: 'Забанені' },
];

export default function Users() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const list = useAdminData(
    () => api<{ rows: AdminUserRow[]; total: number; pageSize: number }>(`/users?q=${encodeURIComponent(query)}&page=${page}&filter=${filter}`),
    [query, page, filter],
  );
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <section className="adm-card">
      <h2>Гравці {d ? `(${d.total})` : ''}</h2>
      <form className="adm-row" onSubmit={(e) => { e.preventDefault(); setPage(0); setQuery(q.trim()); }}>
        <input className="adm-input" placeholder="Нік, пошта, код друга або ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="adm-btn adm-btn--primary" type="submit">Знайти</button>
      </form>
      <div className="adm-seg" role="group" aria-label="Фільтр">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`adm-seg__btn${filter === f.id ? ' adm-seg__btn--on' : ''}`}
            onClick={() => { setFilter(f.id); setPage(0); }}>{f.label}</button>
        ))}
      </div>
      {list.error && <p className="adm-err">{list.error}</p>}
      <div className="adm-table-wrap">
        <table className="adm-table adm-table--click">
          <thead><tr><th>Нік</th><th>Пошта</th><th>Тип</th><th>Ігор</th><th>Активність</th><th>Реєстрація</th></tr></thead>
          <tbody>
            {d?.rows.map((u) => (
              <tr key={u.id} onClick={() => go('users', u.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') go('users', u.id); }}>
                <td>
                  {u.online && <span title="Онлайн">🟢 </span>}
                  {u.displayName ?? <span className="adm-muted">без імені</span>}
                  {u.banned && <span className="adm-pill adm-pill--bad">бан</span>}
                </td>
                <td>{u.email ?? '—'}</td>
                <td>{u.isGuest ? 'гість' : 'акаунт'}</td>
                <td className="adm-num">{u.games}</td>
                <td>{fmtDay(u.lastActive)}</td>
                <td>{fmtDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d && d.rows.length === 0 && <p className="adm-muted">Нікого не знайдено.</p>}
      <Pager page={page} pages={pages} onPage={setPage} />
    </section>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="adm-row adm-pager">
      <button type="button" className="adm-btn" disabled={page === 0} onClick={() => onPage(page - 1)}>←</button>
      <span>{page + 1} / {pages}</span>
      <button type="button" className="adm-btn" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>→</button>
    </div>
  );
}
