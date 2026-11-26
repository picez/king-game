import { useState } from 'react';
import { adminBase, api, del, fmtDate, fmtDay, GAME_LABEL, post } from './adminApi';
import { useAction, useAdminData } from './useAdminData';
import { go } from './AdminApp';
import type { AdminUserDetail } from '../net/admin';

const OUTCOME: Record<string, string> = { win: 'перемога', loss: 'поразка', draw: 'нічия', pending: 'триває', forfeit: 'здався' };
const KIND: Record<string, string> = { complaint: '⚠️ Скарга', suggestion: '💡 Побажання', bug: '🐞 Помилка' };

export default function UserCard({ id }: { id: string }) {
  const user = useAdminData(() => api<AdminUserDetail>(`/users/${id}`), [id]);
  const act = useAction();
  const [banReason, setBanReason] = useState('');
  const [chips, setChips] = useState('');
  const [chipsReason, setChipsReason] = useState('');
  const u = user.data;

  const done = async (fn: () => Promise<unknown>, ok: string) => { if (await act.run(fn, ok)) void user.reload(); };

  if (user.error) return <section className="adm-card"><p className="adm-err">{user.error}</p><BackLink /></section>;
  if (!u) return <section className="adm-card"><p className="adm-muted">Завантаження…</p></section>;
  const protectedTarget = u.isAdmin;

  return (
    <div className="adm-stack">
      <section className="adm-card">
        <BackLink />
        <div className="adm-user-head">
          {u.avatarImageUrl
            ? <img className="adm-avatar" src={`${adminBase()}${u.avatarImageUrl}`} alt="" />
            : <span className="adm-avatar adm-avatar--emoji" aria-hidden="true">👤</span>}
          <div>
            <h2>{u.displayName ?? 'без імені'} {u.online && <span title="Онлайн">🟢</span>}</h2>
            <p className="adm-muted">
              {u.isGuest ? 'Гість' : `Акаунт${u.provider ? ` · ${u.provider}` : ''}`}
              {u.email && ` · ${u.email}`}
              {u.isAdmin && ' · 🛡️ адміністратор'}
            </p>
            <p className="adm-muted"><code>{u.id}</code>{u.friendCode && <> · код друга <code>{u.friendCode}</code></>}</p>
          </div>
        </div>
        {u.ban && (
          <p className="adm-banner adm-banner--bad">
            ⛔ Забанено {fmtDate(u.ban.bannedAt)}{u.ban.bannedBy && ` (${u.ban.bannedBy})`}{u.ban.reason && ` — «${u.ban.reason}»`}
          </p>
        )}
        <dl className="adm-dl">
          <dt>Реєстрація</dt><dd>{fmtDate(u.createdAt)}</dd>
          <dt>Остання активність</dt><dd>{fmtDay(u.lastActive)}</dd>
          <dt>Активні сесії</dt><dd>{u.sessions}</dd>
          <dt>Друзів</dt><dd>{u.friends}</dd>
          <dt>Фішки покеру</dt><dd>{u.chips ?? '—'}</dd>
          <dt>Ігор (зі статистикою)</dt><dd>{u.games}</dd>
        </dl>
        <a href={`#/log/${u.id}`} className="adm-link">📜 Дії адмінів щодо гравця</a>
      </section>

      {act.msg && <p className={act.msg.ok ? 'adm-ok' : 'adm-err'}>{act.msg.text}</p>}

      {!protectedTarget && (
        <section className="adm-card">
          <h2>Модерація</h2>
          {u.ban ? (
            <button type="button" className="adm-btn" disabled={act.busy}
              onClick={() => void done(() => del(`/users/${u.id}/ban`), 'Бан знято.')}>Зняти бан</button>
          ) : (
            <div className="adm-row">
              <input className="adm-input" placeholder="Причина бану" maxLength={200} value={banReason} onChange={(e) => setBanReason(e.target.value)} />
              <button type="button" className="adm-btn adm-btn--danger" disabled={act.busy} onClick={() => {
                if (!window.confirm(`Забанити «${u.displayName ?? u.id}»? Усі сесії буде завершено, гравця викине з кімнат, вхід заблоковано.`)) return;
                void done(() => post(`/users/${u.id}/ban`, { reason: banReason }), 'Гравця забанено.');
              }}>⛔ Забанити</button>
            </div>
          )}
          <div className="adm-row">
            <button type="button" className="adm-btn" disabled={act.busy} onClick={() => {
              if (window.confirm('Скинути нік на «Гравець-XXXX»?')) void done(() => post(`/users/${u.id}/reset-nickname`), 'Нік скинуто.');
            }}>Скинути нік</button>
            <button type="button" className="adm-btn" disabled={act.busy} onClick={() => {
              if (window.confirm('Видалити завантажений аватар і емодзі?')) void done(() => post(`/users/${u.id}/reset-avatar`), 'Аватар скинуто.');
            }}>Скинути аватар</button>
            <button type="button" className="adm-btn" disabled={act.busy || u.sessions === 0} onClick={() => {
              if (window.confirm('Завершити всі сесії (вийти з усіх пристроїв)?')) void done(() => post(`/users/${u.id}/revoke-sessions`), 'Сесії завершено.');
            }}>Вийти з усіх пристроїв</button>
          </div>
        </section>
      )}

      {!u.isGuest && !protectedTarget && (
        <section className="adm-card">
          <h2>Фішки покеру</h2>
          <p className="adm-muted">Поточний баланс: <strong>{u.chips ?? 0}</strong>. Додатне число — нарахувати, від’ємне — списати. Запис іде в журнал гаманця з причиною «admin_adjust».</p>
          <div className="adm-row">
            <input className="adm-input adm-input--num" type="number" placeholder="+1000 або -500" value={chips} onChange={(e) => setChips(e.target.value)} />
            <input className="adm-input" placeholder="Причина (обов’язково)" maxLength={200} value={chipsReason} onChange={(e) => setChipsReason(e.target.value)} />
            <button type="button" className="adm-btn adm-btn--primary" disabled={act.busy || !Number(chips) || !chipsReason.trim()} onClick={() => {
              const amount = Math.trunc(Number(chips));
              if (!window.confirm(`${amount > 0 ? 'Нарахувати' : 'Списати'} ${Math.abs(amount)} фішок?`)) return;
              void done(() => post(`/users/${u.id}/chips`, { amount, reason: chipsReason.trim(), opId: crypto.randomUUID() }), 'Баланс змінено.')
                .then(() => { setChips(''); setChipsReason(''); });
            }}>Застосувати</button>
          </div>
        </section>
      )}

      <section className="adm-card">
        <h2>Статистика</h2>
        {u.stats.length === 0 ? <p className="adm-muted">Немає записаних ігор.</p> : (
          <table className="adm-table">
            <thead><tr><th>Гра</th><th>Зіграно</th><th>Перемог</th><th>%</th><th /></tr></thead>
            <tbody>
              {u.stats.map((s) => (
                <tr key={s.gameType}>
                  <td>{GAME_LABEL[s.gameType] ?? s.gameType}</td>
                  <td className="adm-num">{s.played}</td>
                  <td className="adm-num">{s.won}</td>
                  <td className="adm-num">{s.played ? Math.round((s.won / s.played) * 100) : 0}%</td>
                  <td>{!protectedTarget && (
                    <button type="button" className="adm-btn adm-btn--small" disabled={act.busy} onClick={() => {
                      if (window.confirm(`Скинути статистику «${GAME_LABEL[s.gameType] ?? s.gameType}»? Лідерборд перерахується без неї.`)) {
                        void done(() => post(`/users/${u.id}/reset-stats`, { gameType: s.gameType }), 'Статистику скинуто.');
                      }
                    }}>Скинути</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="adm-card">
        <h2>Останні онлайн-матчі</h2>
        {u.recentMatches.length === 0 ? <p className="adm-muted">Немає.</p> : (
          <table className="adm-table">
            <thead><tr><th>Коли</th><th>Гра</th><th>Склад</th><th>Результат</th></tr></thead>
            <tbody>{u.recentMatches.map((m) => (
              <tr key={m.matchId}>
                <td>{fmtDate(m.startedAt)}</td>
                <td>{GAME_LABEL[m.gameType] ?? m.gameType}</td>
                <td>{m.category === 'human_only' ? 'лише люди' : 'з ботами'}</td>
                <td>{OUTCOME[m.outcome] ?? m.outcome}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="adm-card">
        <h2>Звернення гравця</h2>
        {u.feedback.length === 0 ? <p className="adm-muted">Немає.</p> : (
          <ul className="adm-list">{u.feedback.map((f) => (
            <li key={f.id}><span>{KIND[f.kind]}</span> · <span className="adm-muted">{fmtDate(f.createdAt)} · {f.status === 'open' ? 'відкрите' : 'закрите'}</span><p>{f.text}</p></li>
          ))}</ul>
        )}
      </section>

      {!protectedTarget && (
        <section className="adm-card adm-card--danger">
          <h2>Небезпечна зона</h2>
          <p className="adm-muted">Видалення акаунта безповоротне: профіль, налаштування, статистика, друзі та гаманець зникнуть. Записи журналу збережуть нік.</p>
          <button type="button" className="adm-btn adm-btn--danger" disabled={act.busy} onClick={() => {
            const need = u.displayName ?? u.id;
            const typed = window.prompt(`Щоб видалити, введіть точно: ${need}`);
            if (typed === null) return;
            void act.run(() => del(`/users/${u.id}`, { confirm: typed }), 'Акаунт видалено.').then((ok) => { if (ok) go('users'); });
          }}>🗑 Видалити акаунт</button>
        </section>
      )}
    </div>
  );
}

function BackLink() {
  return <a href="#/users" className="adm-link">← До списку гравців</a>;
}
