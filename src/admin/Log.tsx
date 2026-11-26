import { useState } from 'react';
import { api, fmtDate } from './adminApi';
import { useAdminData } from './useAdminData';
import { Pager } from './Users';
import {
  ADMIN_ACTION_GROUPS, ADMIN_ACTION_LABEL, ADMIN_GROUP_LABEL, buildLogCsv,
  type AdminActionGroup, type AdminActionKind, type AdminLogRow,
} from '../net/admin';

const GROUPS = Object.keys(ADMIN_ACTION_GROUPS) as AdminActionGroup[];

function detailsText(d: Record<string, unknown>): string {
  return Object.entries(d).filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
}

export default function Log({ target }: { target: string | null }) {
  const [groups, setGroups] = useState<AdminActionGroup[]>([]);
  const [admin, setAdmin] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const qs = new URLSearchParams({
    ...(groups.length ? { groups: groups.join(',') } : {}), ...(admin ? { admin } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(query ? { q: query } : {}), ...(target ? { target } : {}),
  }).toString();
  const log = useAdminData(
    () => api<{ rows: AdminLogRow[]; total: number; pageSize: number; admins: { id: string; label: string }[] }>(`/log?${qs}&page=${page}`),
    [qs, page],
  );
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      const { rows } = await api<{ rows: AdminLogRow[] }>(`/log/export?${qs}`);
      const blob = new Blob([buildLogCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `admin-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  }

  const d = log.data;
  return (
    <section className="adm-card">
      <div className="adm-row adm-row--between">
        <h2>Журнал дій адміністраторів {d ? `(${d.total})` : ''}</h2>
        <button type="button" className="adm-btn" disabled={exporting} onClick={() => void exportCsv()}>⬇ CSV</button>
      </div>
      {target && <p className="adm-banner">Фільтр за гравцем · <a href="#/log">зняти</a></p>}
      <div className="adm-seg" role="group" aria-label="Групи дій">
        {GROUPS.map((g) => (
          <button key={g} type="button" className={`adm-seg__btn${groups.includes(g) ? ' adm-seg__btn--on' : ''}`}
            onClick={() => { setPage(0); setGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]); }}>
            {ADMIN_GROUP_LABEL[g]}
          </button>
        ))}
      </div>
      <form className="adm-row" onSubmit={(e) => { e.preventDefault(); setPage(0); setQuery(q.trim()); }}>
        <select className="adm-input" value={admin} onChange={(e) => { setAdmin(e.target.value); setPage(0); }} aria-label="Адмін">
          <option value="">Усі адміни</option>
          {d?.admins.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <label className="adm-inline">з <input className="adm-input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label>
        <label className="adm-inline">по <input className="adm-input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></label>
        <input className="adm-input" placeholder="Пошук у журналі" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="adm-btn" type="submit">Шукати</button>
      </form>
      {log.error && <p className="adm-err">{log.error}</p>}
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Час</th><th>Адмін</th><th>Дія</th><th>Гравець</th><th>Деталі</th></tr></thead>
          <tbody>{d?.rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDate(r.at)}</td>
              <td>{r.adminLabel ?? '—'}</td>
              <td>{ADMIN_ACTION_LABEL[r.kind as AdminActionKind] ?? r.kind}</td>
              <td>{r.targetUserId ? <a href={`#/users/${r.targetUserId}`}>{r.targetLabel ?? r.targetUserId.slice(0, 8)}</a> : (r.targetLabel ?? '—')}</td>
              <td className="adm-small">{detailsText(r.details)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {d?.rows.length === 0 && <p className="adm-muted">Записів немає.</p>}
      {d && <Pager page={page} pages={Math.max(1, Math.ceil(d.total / d.pageSize))} onPage={setPage} />}
      <p className="adm-muted adm-small">Час і фільтр днів — за Києвом. Експорт — до 10 000 рядків з поточними фільтрами.</p>
    </section>
  );
}
