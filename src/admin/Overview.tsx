import { useState } from 'react';
import { api, fmtDate, GAME_LABEL } from './adminApi';
import { useAdminData } from './useAdminData';
import { BarChart, HBarList, StatTile } from './charts';
import { METRIC_PERIODS, type AdminHealth, type AdminMetrics, type AdminStats } from '../net/admin';

const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** Weekly buckets for the year view so 365 bars don't turn into a smear. */
function weekly(b: AdminMetrics['buckets'], key: 'games' | 'newUsers' | 'activeUsers' | 'players') {
  if (b.length <= 92) return b.map((x) => ({ key: x.day, label: dayLabel(x.day), value: x[key] }));
  const out: { key: string; label: string; value: number }[] = [];
  for (let i = 0; i < b.length; i += 7) {
    const chunk = b.slice(i, i + 7);
    out.push({ key: chunk[0].day, label: dayLabel(chunk[0].day), value: chunk.reduce((a, x) => a + x[key], 0) });
  }
  return out;
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} д ${h} год` : h ? `${h} год ${m} хв` : `${m} хв`;
}

export default function Overview() {
  const stats = useAdminData(() => api<AdminStats>('/stats'), [], 30_000);
  const [period, setPeriod] = useState<number>(30);
  const metrics = useAdminData(() => api<AdminMetrics>(`/metrics?period=${period}`), [period]);
  const health = useAdminData(() => api<AdminHealth>('/health'), [], 60_000);
  const s = stats.data, m = metrics.data, h = health.data;

  return (
    <div className="adm-stack">
      <section className="adm-card">
        <h2>Зараз</h2>
        {stats.error && <p className="adm-err">{stats.error}</p>}
        {s && (
          <div className="adm-tiles">
            <StatTile label="Онлайн (акаунти)" value={s.users.online} />
            <StatTile label="З’єднань" value={s.live.connections} />
            <StatTile label="Кімнат" value={s.live.rooms} hint={`${s.live.inGame} у грі · ${s.live.lobby} у лобі`} />
            <StatTile label="Гравців за столами" value={s.live.humans} hint={`+ ${s.live.bots} ботів`} />
            <StatTile label="Відкриті звернення" value={s.appeals.openFeedback} />
            <StatTile label="Нові помилки" value={s.appeals.newErrors} />
          </div>
        )}
      </section>

      {s && (
        <section className="adm-card">
          <h2>Користувачі та ігри</h2>
          <div className="adm-tiles">
            <StatTile label="Усього користувачів" value={s.users.total} hint={`${s.users.accounts} акаунтів · ${s.users.guests} гостей`} />
            <StatTile label="Нових за 7 днів" value={s.users.new7} />
            <StatTile label="Нових за 30 днів" value={s.users.new30} />
            <StatTile label="Забанено" value={s.users.banned} />
            <StatTile label="Онлайн-ігор сьогодні" value={s.games.today} />
            <StatTile label="За 7 днів" value={s.games.d7} />
            <StatTile label="За 30 днів" value={s.games.d30} />
            <StatTile label="Усього" value={s.games.total} />
          </div>
          <h3>Онлайн-ігри за 30 днів, за грою</h3>
          <HBarList rows={s.games.byGame.map((g) => ({ key: g.gameType, label: GAME_LABEL[g.gameType] ?? g.gameType, value: g.d30 }))} />
        </section>
      )}

      <section className="adm-card">
        <div className="adm-row adm-row--between">
          <h2>Метрики</h2>
          <div className="adm-seg" role="group" aria-label="Період">
            {METRIC_PERIODS.map((p) => (
              <button key={p} type="button" className={`adm-seg__btn${p === period ? ' adm-seg__btn--on' : ''}`} onClick={() => setPeriod(p)}>
                {p === 365 ? 'Рік' : `${p} днів`}
              </button>
            ))}
          </div>
        </div>
        {metrics.error && <p className="adm-err">{metrics.error}</p>}
        {m && (
          <>
            <div className="adm-tiles">
              <StatTile label="DAU" value={m.summary.dau} hint="Активні сьогодні" />
              <StatTile label="WAU" value={m.summary.wau} hint="Активні за 7 днів" />
              <StatTile label="MAU" value={m.summary.mau} hint="Активні за 30 днів" />
              <StatTile label="Залученість" value={m.summary.mau ? `${Math.round((m.summary.dau / m.summary.mau) * 100)}%` : '—'} hint="DAU / MAU" />
              <StatTile label="Ігор за період" value={m.summary.games} prev={m.summary.prevGames} />
              <StatTile label="Нових за період" value={m.summary.newUsers} prev={m.summary.prevNewUsers} />
            </div>
            <div className="adm-grid2">
              <div><h3>Онлайн-ігри {period > 92 ? '(по тижнях)' : 'по днях'}</h3><BarChart data={weekly(m.buckets, 'games')} /></div>
              <div><h3>Активні користувачі</h3><BarChart data={weekly(m.buckets, 'activeUsers')} /></div>
              <div><h3>Нові користувачі</h3><BarChart data={weekly(m.buckets, 'newUsers')} /></div>
              <div><h3>Гравці з акаунтом у онлайн-іграх</h3><BarChart data={weekly(m.buckets, 'players')} /></div>
              <div><h3>Старти ігор за годиною (Київ)</h3><BarChart data={m.byHour.map((v, i) => ({ key: String(i), label: String(i), value: v }))} /></div>
              <div><h3>Ігри за період, за грою</h3><HBarList rows={m.byGame.map((g) => ({ key: g.gameType, label: GAME_LABEL[g.gameType] ?? g.gameType, value: g.games }))} /></div>
            </div>
            <h3>Найактивніші гравці</h3>
            <HBarList rows={m.topPlayers.map((p) => ({ key: p.userId, label: p.name, value: p.games }))} />
          </>
        )}
      </section>

      <section className="adm-card">
        <h2>Здоров’я сервера</h2>
        {health.error && <p className="adm-err">{health.error}</p>}
        {h && (
          <>
            <div className="adm-tiles">
              <StatTile label="Версія" value={h.version} hint={h.commit ?? ''} />
              <StatTile label="Працює" value={fmtUptime(h.uptimeSec)} />
              <StatTile label="Пам’ять (RSS)" value={`${h.memory.rssMb} МБ`} hint={`heap ${h.memory.heapUsedMb}/${h.memory.heapTotalMb} МБ`} />
              <StatTile label="Затримка циклу подій" value={`${h.eventLoopLagMs} мс`} hint="Найгірша за хвилину" />
              <StatTile label="Розмір БД" value={h.db?.sizeMb != null ? `${h.db.sizeMb} МБ` : '—'} />
              <StatTile label="Міграції" value={h.migrations ? `${h.migrations.applied}/${h.migrations.files}` : '—'} />
            </div>
            <p className="adm-muted">Node {h.node} · коміт {h.commit ?? '—'} · оновлено {fmtDate(new Date().toISOString())}</p>
            {h.db && (
              <details>
                <summary>Рядки в таблицях</summary>
                <table className="adm-table"><tbody>
                  {h.db.tables.map((t) => <tr key={t.name}><td>{t.name}</td><td className="adm-num">{t.rows}</td></tr>)}
                </tbody></table>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
