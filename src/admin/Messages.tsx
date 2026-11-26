import { useState } from 'react';
import { api, del, fmtDate, post, put } from './adminApi';
import { useAction, useAdminData } from './useAdminData';
import {
  ANNOUNCEMENT_TEXT_MAX, BROADCAST_TEXT_MAX, BROADCAST_TITLE_MAX,
  type AdminBroadcastRow, type AdminUserRow, type Announcement,
} from '../net/admin';

interface AnnHistory { id: string; text: string; url: string | null; createdAt: string; clearedAt: string | null; expiresAt: string | null }

export function AnnouncementTab() {
  const data = useAdminData(() => api<{ current: Announcement | null; history: AnnHistory[] }>('/announcement'), []);
  const act = useAction();
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [days, setDays] = useState('7');
  const cur = data.data?.current ?? null;

  return (
    <div className="adm-stack">
      <section className="adm-card">
        <h2>Оголошення на сайті</h2>
        <p className="adm-muted">Банер угорі головного меню (за ігровим столом не показується). Гравець може закрити його — нове оголошення з’явиться знову. Кеш на сервері — до 1 хвилини.</p>
        {cur ? (
          <div className="adm-banner">
            📣 {cur.text}{cur.url && <> · <a href={cur.url} target="_blank" rel="noreferrer">{cur.url}</a></>}
            <span className="adm-muted"> · {cur.expiresAt ? `до ${fmtDate(cur.expiresAt)}` : 'без терміну'}</span>
            <button type="button" className="adm-btn adm-btn--small" disabled={act.busy}
              onClick={() => void act.run(() => del('/announcement'), 'Оголошення знято.').then(() => data.reload())}>Зняти</button>
          </div>
        ) : <p className="adm-muted">Зараз оголошення немає.</p>}
        <label className="adm-field">
          <span>Текст ({text.length}/{ANNOUNCEMENT_TEXT_MAX})</span>
          <textarea className="adm-input" rows={2} maxLength={ANNOUNCEMENT_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="adm-row">
          <label className="adm-field"><span>Посилання (необов’язково)</span>
            <input className="adm-input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <label className="adm-field"><span>Діє днів (0 = без терміну)</span>
            <input className="adm-input adm-input--num" type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></label>
        </div>
        <button type="button" className="adm-btn adm-btn--primary" disabled={act.busy || !text.trim()}
          onClick={() => void act.run(() => put('/announcement', { text: text.trim(), url: url.trim(), days: Number(days) }), 'Оголошення опубліковано.')
            .then((ok) => { if (ok) { setText(''); setUrl(''); void data.reload(); } })}>
          Опублікувати {cur ? '(замінить поточне)' : ''}
        </button>
        {act.msg && <p className={act.msg.ok ? 'adm-ok' : 'adm-err'}>{act.msg.text}</p>}
      </section>
      <section className="adm-card">
        <h2>Історія</h2>
        <table className="adm-table">
          <thead><tr><th>Створено</th><th>Текст</th><th>Знято</th></tr></thead>
          <tbody>{data.data?.history.map((h) => (
            <tr key={h.id}><td>{fmtDate(h.createdAt)}</td><td>{h.text}</td><td>{h.clearedAt ? fmtDate(h.clearedAt) : h.expiresAt && new Date(h.expiresAt) < new Date() ? 'минуло' : 'активне'}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}

export function BroadcastTab() {
  const data = useAdminData(() => api<{ history: AdminBroadcastRow[]; audience: number }>('/broadcasts'), []);
  const act = useAction();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'all' | 'people'>('all');
  const [people, setPeople] = useState<AdminUserRow[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<AdminUserRow[]>([]);

  async function search() {
    if (!q.trim()) return;
    const r = await api<{ rows: AdminUserRow[] }>(`/users?q=${encodeURIComponent(q.trim())}`).catch(() => ({ rows: [] }));
    setFound(r.rows);
  }

  const audience = mode === 'all' ? data.data?.audience ?? 0 : people.length;
  return (
    <div className="adm-stack">
      <section className="adm-card">
        <h2>Розсилка у «Вхідні»</h2>
        <p className="adm-muted">Повідомлення з’явиться в меню гравця («Скарги і побажання» → «Вхідні») з лічильником непрочитаних. Не частіше ніж раз на 10 хвилин і до 10 на добу.</p>
        <div className="adm-seg">
          <button type="button" className={`adm-seg__btn${mode === 'all' ? ' adm-seg__btn--on' : ''}`} onClick={() => setMode('all')}>Усім активним (90 днів)</button>
          <button type="button" className={`adm-seg__btn${mode === 'people' ? ' adm-seg__btn--on' : ''}`} onClick={() => setMode('people')}>Вибраним гравцям</button>
        </div>
        {mode === 'people' && (
          <div className="adm-picker">
            <div className="adm-row">
              <input className="adm-input" placeholder="Пошук гравця" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} />
              <button type="button" className="adm-btn" onClick={() => void search()}>Знайти</button>
            </div>
            <ul className="adm-chips">
              {found.filter((f) => !people.some((p) => p.id === f.id)).slice(0, 10).map((f) => (
                <li key={f.id}><button type="button" className="adm-chip" onClick={() => setPeople([...people, f])}>+ {f.displayName ?? f.id.slice(0, 8)}</button></li>
              ))}
            </ul>
            <ul className="adm-chips">
              {people.map((p) => (
                <li key={p.id}><button type="button" className="adm-chip adm-chip--on" onClick={() => setPeople(people.filter((x) => x.id !== p.id))}>{p.displayName ?? p.id.slice(0, 8)} ×</button></li>
              ))}
            </ul>
          </div>
        )}
        <label className="adm-field"><span>Заголовок ({title.length}/{BROADCAST_TITLE_MAX})</span>
          <input className="adm-input" maxLength={BROADCAST_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="adm-field"><span>Текст ({text.length}/{BROADCAST_TEXT_MAX})</span>
          <textarea className="adm-input" rows={4} maxLength={BROADCAST_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <button type="button" className="adm-btn adm-btn--primary" disabled={act.busy || !title.trim() || !text.trim() || audience === 0}
          onClick={() => {
            if (!window.confirm(`Надіслати «${title.trim()}» — отримувачів: ${audience}?`)) return;
            void act.run(() => post('/broadcasts', { title: title.trim(), text: text.trim(), ...(mode === 'people' ? { people: people.map((p) => p.id) } : {}) }), 'Розсилку надіслано.')
              .then((ok) => { if (ok) { setTitle(''); setText(''); setPeople([]); void data.reload(); } });
          }}>Надіслати ({audience})</button>
        {act.msg && <p className={act.msg.ok ? 'adm-ok' : 'adm-err'}>{act.msg.text}</p>}
      </section>
      <section className="adm-card">
        <h2>Історія розсилок</h2>
        <table className="adm-table">
          <thead><tr><th>Коли</th><th>Заголовок</th><th>Кому</th><th>Доставлено</th><th>Прочитано</th><th>Автор</th></tr></thead>
          <tbody>{data.data?.history.map((b) => (
            <tr key={b.id} title={b.text}>
              <td>{fmtDate(b.createdAt)}</td><td>{b.title}</td><td>{b.recipients === 'all' ? 'усім' : 'вибраним'}</td>
              <td className="adm-num">{b.peopleCount}</td><td className="adm-num">{b.readCount}</td><td>{b.createdBy ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
