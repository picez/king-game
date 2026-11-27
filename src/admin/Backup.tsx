import { useState } from 'react';
import type { AdminBackupStatus } from '../net/admin';
import { AdminApiError, adminBase, api, errorText, fmtDate, post } from './adminApi';
import { useAdminData } from './useAdminData';

/** Fetches a binary admin download and saves it under the server's file name. */
async function saveDownload(path: string, fallback: string): Promise<{ name: string; size: number }> {
  const res = await fetch(`${adminBase()}/api/admin${path}`, { credentials: 'include' });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try { code = ((await res.json()) as { error?: string }).error ?? code; } catch { /* body */ }
    throw new AdminApiError(res.status, code);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return { name, size: blob.size };
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} КБ`;

/**
 * Stage 44.1: daily cloud copies in Cloudflare R2 (list, make one now, download)
 * + the manual JSON download from 44.0.
 */
export default function Backup() {
  const { data, error, reload } = useAdminData(() => api<AdminBackupStatus>('/backups'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(id: string, fn: () => Promise<string>) {
    setBusy(id); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }

  const runNow = () => act('run', async () => {
    const r = await post<{ key: string | null; bytes: number | null }>('/backups/run');
    await reload();
    return r.key ? `Копію збережено: ${r.key.split('/').pop()} (${kb(r.bytes ?? 0)}).` : 'Копію щойно зробив інший екземпляр сервера.';
  });
  const downloadCloud = (key: string) => act(key, async () => {
    const f = await saveDownload(`/backups/download?key=${encodeURIComponent(key)}`, 'backup.json.gz');
    return `Завантажено ${f.name} (${kb(f.size)}).`;
  });
  const downloadNow = () => act('manual', async () => {
    const f = await saveDownload('/backup', 'backup.json');
    return `Завантажено ${f.name} (${kb(f.size)}).`;
  });

  return (
    <>
      <section className="adm-card">
        <h2>Автоматичні копії в хмарі</h2>
        {error && <p className="adm-err">{error}</p>}
        {data && !data.configured && (
          <p className="adm-muted">
            Хмарне сховище не налаштоване. Додайте на сервері змінні <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>,{' '}
            <code>R2_SECRET_ACCESS_KEY</code>, <code>R2_BUCKET</code> — після цього копія робитиметься щодня.
          </p>
        )}
        {data && !data.configured && (
          <p className="adm-muted">
            Без хмари копії можна тримати на комп'ютері власника: <code>npm run db:backup:local</code> (щоденно через{' '}
            <code>scripts/schedule-local-backup.ps1</code>, зберігаються 30 днів у <code>.data/prod-backups/</code>).
          </p>
        )}
        {data && data.configured && (
          <>
            <p className="adm-muted">
              {data.scheduled ? 'Копія робиться автоматично раз на добу.' : 'Розклад вимкнено (не продакшен або DB_BACKUP=off) — лише вручну.'}{' '}
              Зберігаються 14 останніх копій і по одній за кожен із 8 останніх тижнів.
            </p>
            {data.lastRun && (
              <p className={data.lastRun.ok ? 'adm-ok' : 'adm-err'}>
                Остання спроба {fmtDate(data.lastRun.at)} ({data.lastRun.reason === 'manual' ? 'вручну' : 'за розкладом'}):{' '}
                {data.lastRun.ok ? `успішно, ${kb(data.lastRun.bytes ?? 0)}` : `помилка — ${data.lastRun.error}`}
              </p>
            )}
            {data.listError && <p className="adm-err">Не вдалося прочитати сховище: {data.listError}</p>}
            <div className="adm-row">
              <button type="button" className="adm-btn adm-btn--primary" disabled={busy !== null || data.running} onClick={() => void runNow()}>
                {busy === 'run' || data.running ? 'Роблю копію…' : '☁️ Зробити копію зараз'}
              </button>
            </div>
            {data.backups.length === 0 && !data.listError && <p className="adm-muted">Копій ще немає.</p>}
            {data.backups.length > 0 && (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>Коли</th><th>Розмір</th><th /></tr></thead>
                  <tbody>
                    {data.backups.map((b) => (
                      <tr key={b.key}>
                        <td>{fmtDate(b.at)}</td>
                        <td>{kb(b.size)}</td>
                        <td>
                          <button type="button" className="adm-btn" disabled={busy !== null} onClick={() => void downloadCloud(b.key)}>
                            {busy === b.key ? 'Завантажую…' : 'Завантажити'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {msg && <p className={msg.ok ? 'adm-ok' : 'adm-err'}>{msg.text}</p>}
      </section>

      <section className="adm-card">
        <h2>Завантажити копію зараз</h2>
        <p>Файл JSON з усіма таблицями: користувачі, налаштування, статистика, друзі, фішки покеру та журнал гаманця, онлайн-матчі, звернення, журнал адмінів, оголошення, розсилки.</p>
        <p className="adm-muted">Не входять: сесії (їх неможливо відновити безпечно), стан OAuth, байти завантажених аватарів. Кожне вивантаження пишеться в журнал.</p>
        <button type="button" className="adm-btn" disabled={busy !== null} onClick={() => void downloadNow()}>
          {busy === 'manual' ? 'Готую…' : '💾 Завантажити резервну копію'}
        </button>
        <details>
          <summary>Як відновити</summary>
          <p className="adm-muted">
            На порожній базі: <code>npm run db:migrate</code>, потім <code>npm run db:restore -- шлях/до/файлу.json.gz</code>{' '}
            (працює і з <code>.json</code>). Скрипт відмовиться писати в непорожню базу; <code>--force</code> спершу очищає таблиці копії.
            Адмінка відновлення не запускає, щоб випадково не перезаписати живі дані.
          </p>
        </details>
      </section>
    </>
  );
}
