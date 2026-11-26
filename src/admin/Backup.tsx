import { useState } from 'react';
import { adminBase, errorText, AdminApiError } from './adminApi';

/**
 * Manual backup: downloads every gameplay/account table as one JSON file (sessions,
 * OAuth state and avatar image bytes are excluded). The quiz project ships backups to
 * object storage on a schedule; here there is no bucket, so the admin downloads it.
 */
export default function Backup() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function download() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${adminBase()}/api/admin/backup`, { credentials: 'include' });
      if (!res.ok) {
        let code = `http_${res.status}`;
        try { code = ((await res.json()) as { error?: string }).error ?? code; } catch { /* body */ }
        throw new AdminApiError(res.status, code);
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'backup.json';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ ok: true, text: `Завантажено ${name} (${Math.round(blob.size / 1024)} КБ).` });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally { setBusy(false); }
  }

  return (
    <section className="adm-card">
      <h2>Резервна копія бази даних</h2>
      <p>Файл JSON з усіма таблицями: користувачі, налаштування, статистика, друзі, фішки покеру та журнал гаманця, онлайн-матчі, звернення, журнал адмінів, оголошення, розсилки.</p>
      <p className="adm-muted">Не входять: сесії (їх неможливо відновити безпечно), стан OAuth, байти завантажених аватарів. Кожне вивантаження пишеться в журнал.</p>
      <button type="button" className="adm-btn adm-btn--primary" disabled={busy} onClick={() => void download()}>
        {busy ? 'Готую…' : '💾 Завантажити резервну копію'}
      </button>
      {msg && <p className={msg.ok ? 'adm-ok' : 'adm-err'}>{msg.text}</p>}
      <details>
        <summary>Як відновити</summary>
        <p className="adm-muted">Відновлення — вручну через psql: для кожної таблиці з файлу виконати <code>INSERT … SELECT * FROM json_populate_recordset(null::таблиця, '…')</code> у порожню базу після <code>npm run db:migrate</code>. Адмінка відновлення не запускає, щоб випадково не перезаписати живі дані.</p>
      </details>
    </section>
  );
}
