import { api, fmtDate, GAME_LABEL, post } from './adminApi';
import { useAction, useAdminData } from './useAdminData';
import { go } from './AdminApp';
import type { AdminLiveRoom } from '../net/admin';

export default function Live() {
  const live = useAdminData(() => api<{ rooms: AdminLiveRoom[] }>('/live'), [], 10_000);
  const act = useAction();

  async function close(r: AdminLiveRoom) {
    const reason = window.prompt(`Закрити кімнату ${r.code} (${GAME_LABEL[r.gameType] ?? r.gameType})? Гравців буде повернуто в меню.\nПричина (необов’язково):`, '');
    if (reason === null) return;
    if (await act.run(() => post(`/live/${r.code}/close`, { reason }), `Кімнату ${r.code} закрито.`)) void live.reload();
  }

  const rooms = live.data?.rooms ?? [];
  return (
    <section className="adm-card">
      <div className="adm-row adm-row--between">
        <h2>Живі кімнати ({rooms.length})</h2>
        <button type="button" className="adm-btn" onClick={() => void live.reload()} disabled={live.loading}>↻ Оновити</button>
      </div>
      <p className="adm-muted">Оновлюється кожні 10 секунд.</p>
      {live.error && <p className="adm-err">{live.error}</p>}
      {act.msg && <p className={act.msg.ok ? 'adm-ok' : 'adm-err'}>{act.msg.text}</p>}
      {rooms.length === 0 && !live.loading && <p className="adm-muted">Зараз немає жодної кімнати.</p>}
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Код</th><th>Гра</th><th>Стан</th><th>Хост</th><th>Гравці</th><th>Глядачі</th><th>Оновлено</th><th /></tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.code}>
                <td><code>{r.code}</code>{r.hasPassword && ' 🔒'}</td>
                <td>{GAME_LABEL[r.gameType] ?? r.gameType}</td>
                <td>{r.started ? <span className="adm-pill adm-pill--on">у грі</span> : <span className="adm-pill">лобі</span>}</td>
                <td>{r.hostName ?? '—'}</td>
                <td>
                  <span className="adm-muted">{r.players.length}/{r.capacity} · </span>
                  {r.players.map((p, i) => (
                    <span key={i} className="adm-player">
                      {p.type === 'ai' ? '🤖' : p.connected ? '🟢' : '⚪'}{' '}
                      {p.userId ? <a href="#" onClick={(e) => { e.preventDefault(); go('users', p.userId!); }}>{p.name}</a> : p.name}
                    </span>
                  ))}
                </td>
                <td className="adm-num">{r.spectators}</td>
                <td>{r.updatedAt ? fmtDate(new Date(r.updatedAt).toISOString()) : '—'}</td>
                <td><button type="button" className="adm-btn adm-btn--danger" disabled={act.busy} onClick={() => void close(r)}>Закрити</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
